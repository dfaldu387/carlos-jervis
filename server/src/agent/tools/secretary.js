import { mailProvider } from '../../secretary/provider.js';
import { resolveDay } from '../../secretary/mailbox.js';
import { createTask, tasksDue } from '../../secretary/tasks.js';
import { composeBriefing } from '../../secretary/briefing.js';
import { draftReply } from '../../secretary/drafts.js';
import { recordAudit } from '../../security/audit.js';

/**
 * Secretary tools: mailbox, calendar, tasks and the briefing.
 *
 * Each declares the permission the orchestrator checks before running it,
 * and records its own audit event so a mailbox read by the agent shows up in
 * the trail exactly like one made through the REST routes.
 */

const MAIL_OBJECT = 'mailFolders/inbox/messages';

/** The slice of a message an answer carries; the body stays behind GET /mail/:id. */
const brief = (mail) => ({
  id: mail.id,
  from: mail.from,
  subject: mail.subject,
  receivedAt: mail.receivedAt,
  preview: mail.preview,
  read: mail.read,
  flagged: mail.flagged,
  needsReply: mail.needsReply,
  replied: mail.replied,
  category: mail.category,
  attachments: mail.attachments,
});

export const mailSearch = {
  id: 'mail.search',
  source: 'microsoft365',
  label: 'Mail search',
  description: 'List or search the mailbox: unread, needs-reply, flagged, or a free-text query.',
  permission: 'mail:read',
  async run({ interpretation, access, filter: _filter, limit = 8, q, mailFilter }) {
    const provider = mailProvider();
    const query = q ?? interpretation?.entities?.mailQuery ?? '';
    const selected = mailFilter ?? interpretation?.entities?.mailFilter ?? 'all';
    const result = await provider.listMail({ filter: selected, q: query, limit });
    recordAudit({
      access,
      action: 'mail.read',
      resource: 'inbox',
      outcome: 'ok',
      detail: `agent search filter=${selected}${query ? ` q="${query}"` : ''} (${result.total} matches)`,
    });
    return {
      data: {
        items: result.items.map(brief),
        total: result.total,
        unread: result.unread,
        needsReply: result.needsReply,
        flagged: result.flagged,
        filter: selected,
        query,
        mode: provider.mode,
      },
      citation: {
        source: 'microsoft365',
        object: MAIL_OBJECT,
        detail: `${result.total} messages (${selected}${query ? `, "${query}"` : ''})`,
      },
    };
  },
};

export const mailNeedsReply = {
  id: 'mail.needsReply',
  source: 'microsoft365',
  label: 'Mail awaiting reply',
  description: 'The messages that still need an answer, newest first.',
  permission: 'mail:read',
  async run({ access, limit = 3 }) {
    const provider = mailProvider();
    const result = await provider.listMail({ filter: 'needsReply', limit });
    recordAudit({ access, action: 'mail.read', resource: 'inbox', outcome: 'ok', detail: `agent needs-reply (${result.total})` });
    return {
      data: { items: result.items.map(brief), total: result.total, mode: provider.mode },
      citation: { source: 'microsoft365', object: MAIL_OBJECT, detail: `${result.total} awaiting a reply` },
    };
  },
};

export const mailDraft = {
  id: 'mail.draft',
  source: 'microsoft365',
  label: 'Reply draft',
  description: 'Find the message the user means and draft a reply. Never sends.',
  permission: 'mail:read',
  async run({ interpretation, access, language = 'en' }) {
    const provider = mailProvider();
    const query = interpretation?.entities?.mailQuery ?? '';
    // Prefer the messages that actually need an answer; fall back to any match.
    let result = await provider.listMail({ filter: 'needsReply', q: query, limit: 1 });
    if (result.items.length === 0 && query) result = await provider.listMail({ filter: 'all', q: query, limit: 1 });
    if (result.items.length === 0 && !query) result = await provider.listMail({ filter: 'needsReply', limit: 1 });
    const mail = result.items[0] ?? null;
    if (!mail) {
      return {
        data: { mail: null, draft: null, query, mode: provider.mode },
        citation: { source: 'microsoft365', object: MAIL_OBJECT, detail: `no message matched "${query}"` },
      };
    }
    const draft = await draftReply(mail, { language });
    recordAudit({ access, action: 'mail.draft', resource: mail.id, outcome: 'ok', detail: `agent draft (${draft.provider})` });
    return {
      data: { mail: brief(mail), draft: { mailId: mail.id, ...draft }, query, mode: provider.mode },
      citation: { source: 'microsoft365', object: MAIL_OBJECT, detail: `draft for "${mail.subject}"` },
    };
  },
};

export const calendarEvents = {
  id: 'calendar.events',
  source: 'microsoft365',
  label: 'Calendar',
  description: 'Appointments for today, tomorrow or a named day.',
  permission: 'calendar:read',
  async run({ interpretation, access, day }) {
    const provider = mailProvider();
    const selected = day ?? interpretation?.entities?.calendarDay ?? 'today';
    const result = await provider.listEvents({ day: selected });
    recordAudit({ access, action: 'calendar.read', resource: result.day, outcome: 'ok', detail: `agent (${result.items.length} events)` });
    return {
      data: { items: result.items, day: result.day, requested: selected, mode: provider.mode },
      citation: { source: 'microsoft365', object: 'calendarView', detail: `${result.items.length} events on ${result.day}` },
    };
  },
};

export const tasksDueTool = {
  id: 'tasks.due',
  source: 'tasks',
  label: 'Tasks due',
  description: 'Open tasks due on a day, plus anything overdue.',
  permission: 'tasks:write',
  async run({ interpretation, day }) {
    const selected = resolveDay(day ?? interpretation?.entities?.calendarDay ?? 'today');
    const due = tasksDue({ day: selected });
    return {
      data: { items: [...due.overdue, ...due.dueToday], overdue: due.overdue.length, dueToday: due.dueToday.length, day: selected },
      citation: { source: 'tasks', object: 'tasks.json', detail: `${due.dueToday.length} due, ${due.overdue.length} overdue` },
    };
  },
};

export const tasksCreate = {
  id: 'tasks.create',
  source: 'tasks',
  label: 'Create reminder',
  description: 'Create a task from a "remind me ..." request, with the parsed due time.',
  permission: 'tasks:write',
  async run({ interpretation, access }) {
    const reminder = interpretation?.entities?.reminder ?? null;
    if (!reminder?.title) {
      return {
        data: { task: null, reminder: null },
        citation: { source: 'tasks', object: 'tasks.json', detail: 'no reminder could be parsed' },
      };
    }
    const task = createTask(
      { title: reminder.title, dueAt: reminder.dueAt, source: 'jervis' },
      access?.userId ?? 'demo-user',
    );
    recordAudit({ access, action: 'task.create', resource: task.id, outcome: 'ok', detail: `agent: ${task.title}` });
    return {
      data: { task, reminder, items: [task] },
      citation: { source: 'tasks', object: 'tasks.json', detail: `created ${task.id}` },
    };
  },
};

export const briefingCompose = {
  id: 'briefing.compose',
  source: 'microsoft365',
  label: 'Daily briefing',
  description: 'Calendar, inbox, tasks, production and maintenance for today in one pass.',
  permission: 'calendar:read',
  async run({ access, language = 'en' }) {
    const briefing = await composeBriefing({ access, language });
    recordAudit({
      access,
      action: 'briefing.read',
      resource: briefing.date,
      outcome: 'ok',
      detail: `agent (${briefing.sections.map((section) => section.id).join(',')})`,
    });
    return {
      data: briefing,
      citation: {
        source: 'microsoft365',
        object: 'briefing',
        detail: `${briefing.sections.length} sections for ${briefing.date}`,
      },
    };
  },
};
