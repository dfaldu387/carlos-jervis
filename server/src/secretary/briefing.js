import { getRepository } from '../data/index.js';
import { mailProvider } from './provider.js';
import { tasksDue } from './tasks.js';
import { currentHour, greetingFor } from '../agent/greeting.js';
import { dateLabel, minutesLabel, normalizeLanguage, t, timeLabel } from '../agent/i18n.js';
import { labelFor } from '../agent/labels.js';
import { addDays, now, toIsoDate } from '../utils/dates.js';

/**
 * The daily briefing.
 *
 * One pass over everything a production manager wants before the first
 * meeting: today's calendar, the inbox (unread, needs-reply, the top three to
 * answer), tasks due today or overdue, production (open critical issues and
 * downtime today) and maintenance (open tickets). Every section is gated by
 * the permission that guards the underlying data, so a viewer gets the
 * calendar and tasks and nothing from the mailbox. The `spoken` string is the
 * two-to-four sentence version for text-to-speech.
 *
 * Section: { id, title, headline, items: [{ label, detail, href?, severity? }] }
 */

const SECTION_TITLES = {
  en: { calendar: 'Calendar', mail: 'Inbox', tasks: 'Tasks', production: 'Production', maintenance: 'Maintenance' },
  de: { calendar: 'Kalender', mail: 'Posteingang', tasks: 'Aufgaben', production: 'Produktion', maintenance: 'Wartung' },
};

const S = {
  en: {
    calendarNone: 'No appointments today',
    calendarSome: (n) => `${n} appointment${n === 1 ? '' : 's'} today`,
    calendarFirst: (time, title) => `first at ${time}: ${title}`,
    online: 'online',
    mailHeadline: (unread, needsReply) => `${unread} unread, ${needsReply} waiting for a reply`,
    mailItem: (from) => `from ${from}`,
    tasksNone: 'Nothing due today',
    tasksSome: (due, overdue) =>
      `${due} due today${overdue ? `, ${overdue} overdue` : ''}`,
    due: (time) => `due ${time}`,
    overdue: (date) => `overdue since ${date}`,
    productionHeadline: (critical, total) =>
      `${critical} open critical issue${critical === 1 ? '' : 's'} today, ${total} issue${total === 1 ? '' : 's'} recorded`,
    criticalLabel: 'Open critical issues',
    criticalDetail: (n) => (n ? `${n} need attention` : 'none open'),
    issuesLabel: 'Issues recorded today',
    issuesDetail: (n, line) => (line ? `${n}, most on ${line}` : `${n}`),
    downtimeLabel: 'Downtime today',
    downtimeDetail: (minutes, stops) => `${minutes} across ${stops} stop${stops === 1 ? '' : 's'}`,
    maintenanceHeadline: (open) => `${open} open maintenance ticket${open === 1 ? '' : 's'}`,
    maintenanceNone: 'No open maintenance tickets',
    spokenCalendar: (n, time, title) =>
      n === 0 ? 'Your calendar is clear today.' : `You have ${n} appointment${n === 1 ? '' : 's'} today, the first at ${time}: ${title}.`,
    spokenMail: (unread, needsReply, top) =>
      `${unread} unread emails, ${needsReply} need a reply${top ? `, starting with ${top}` : ''}.`,
    spokenProduction: (critical, downtime) =>
      `${critical} open critical issue${critical === 1 ? '' : 's'} today and ${downtime} of downtime.`,
    spokenTasks: (due, overdue) =>
      due + overdue === 0 ? '' : `${due} task${due === 1 ? '' : 's'} due today${overdue ? ` and ${overdue} overdue` : ''}.`,
  },
  de: {
    calendarNone: 'Keine Termine heute',
    calendarSome: (n) => `${n} Termin${n === 1 ? '' : 'e'} heute`,
    calendarFirst: (time, title) => `der erste um ${time}: ${title}`,
    online: 'online',
    mailHeadline: (unread, needsReply) => `${unread} ungelesen, ${needsReply} warten auf eine Antwort`,
    mailItem: (from) => `von ${from}`,
    tasksNone: 'Heute nichts fällig',
    tasksSome: (due, overdue) =>
      `${due} heute fällig${overdue ? `, ${overdue} überfällig` : ''}`,
    due: (time) => `fällig ${time}`,
    overdue: (date) => `überfällig seit ${date}`,
    productionHeadline: (critical, total) =>
      `${critical} offene${critical === 1 ? 's kritisches Problem' : ' kritische Probleme'} heute, ${total} ${total === 1 ? 'Problem' : 'Probleme'} erfasst`,
    criticalLabel: 'Offene kritische Probleme',
    criticalDetail: (n) => (n ? `${n} brauchen Aufmerksamkeit` : 'keine offen'),
    issuesLabel: 'Heute erfasste Probleme',
    issuesDetail: (n, line) => (line ? `${n}, die meisten auf ${line}` : `${n}`),
    downtimeLabel: 'Stillstand heute',
    downtimeDetail: (minutes, stops) => `${minutes} über ${stops} Stillstand${stops === 1 ? '' : 'e'}`,
    maintenanceHeadline: (open) => `${open} offene${open === 1 ? 's Wartungsticket' : ' Wartungstickets'}`,
    maintenanceNone: 'Keine offenen Wartungstickets',
    spokenCalendar: (n, time, title) =>
      n === 0 ? 'Ihr Kalender ist heute frei.' : `Sie haben heute ${n} Termin${n === 1 ? '' : 'e'}, der erste um ${time}: ${title}.`,
    spokenMail: (unread, needsReply, top) =>
      `${unread} ungelesene E-Mails, ${needsReply} brauchen eine Antwort${top ? `, zuerst ${top}` : ''}.`,
    spokenProduction: (critical, downtime) =>
      `${critical} offene${critical === 1 ? 's kritisches Problem' : ' kritische Probleme'} heute und ${downtime} Stillstand.`,
    spokenTasks: (due, overdue) =>
      due + overdue === 0 ? '' : `${due} Aufgabe${due === 1 ? '' : 'n'} heute fällig${overdue ? ` und ${overdue} überfällig` : ''}.`,
  },
};

const section = (language, id, headline, items) => ({
  id,
  title: SECTION_TITLES[language][id],
  headline,
  items,
});

/**
 * @param {{ access: object, language?: 'en'|'de' }} args
 */
export const composeBriefing = async ({ access, language = 'en' }) => {
  const lang = normalizeLanguage(language);
  const s = S[lang];
  const permissions = access?.permissions ?? [];
  const can = (permission) => permissions.includes(permission);
  const today = toIsoDate(now());
  const sections = [];
  const spoken = [];

  // ---- calendar ------------------------------------------------------------
  if (can('calendar:read')) {
    const { items } = await mailProvider().listEvents({ day: today });
    const first = items[0];
    sections.push(
      section(
        lang,
        'calendar',
        items.length === 0
          ? s.calendarNone
          : `${s.calendarSome(items.length)}, ${s.calendarFirst(timeLabel(first.startsAt), first.title)}`,
        items.map((event) => ({
          label: `${timeLabel(event.startsAt)}-${timeLabel(event.endsAt)} ${event.title}`,
          detail: [event.location, event.isOnline ? s.online : null].filter(Boolean).join(' · '),
          href: `calendar?day=${today}`,
          severity: 'info',
        })),
      ),
    );
    spoken.push(s.spokenCalendar(items.length, first ? timeLabel(first.startsAt) : '', first?.title ?? ''));
  }

  // ---- mail ----------------------------------------------------------------
  let topMail = null;
  if (can('mail:read')) {
    const provider = mailProvider();
    const [all, needsReply] = await Promise.all([
      provider.listMail({ filter: 'all', limit: 1 }),
      provider.listMail({ filter: 'needsReply', limit: 3 }),
    ]);
    topMail = needsReply.items[0] ?? null;
    sections.push(
      section(
        lang,
        'mail',
        s.mailHeadline(all.unread, all.needsReply),
        needsReply.items.map((mail) => ({
          label: mail.subject,
          detail: `${s.mailItem(mail.from.name)} · ${timeLabel(mail.receivedAt)} ${mail.receivedAt.slice(0, 10)}`,
          href: `mail/${mail.id}`,
          severity: mail.flagged ? 'warning' : 'info',
        })),
      ),
    );
    spoken.push(s.spokenMail(all.unread, all.needsReply, topMail ? topMail.from.name : ''));
  }

  // ---- tasks ---------------------------------------------------------------
  if (can('tasks:write')) {
    const due = tasksDue({ day: today });
    const items = [
      ...due.overdue.map((task) => ({
        label: task.title,
        detail: s.overdue(dateLabel(task.dueAt.slice(0, 10), lang)),
        href: `tasks/${task.id}`,
        severity: 'critical',
      })),
      ...due.dueToday.map((task) => ({
        label: task.title,
        detail: s.due(timeLabel(task.dueAt)),
        href: `tasks/${task.id}`,
        severity: 'warning',
      })),
    ];
    sections.push(
      section(
        lang,
        'tasks',
        items.length === 0 ? s.tasksNone : s.tasksSome(due.dueToday.length, due.overdue.length),
        items,
      ),
    );
    const spokenTasks = s.spokenTasks(due.dueToday.length, due.overdue.length);
    if (spokenTasks) spoken.push(spokenTasks);
  }

  // ---- production ----------------------------------------------------------
  if (can('production:read')) {
    const repository = getRepository();
    const day = { from: today, to: today };
    const [critical, total, byLine, downtime] = await Promise.all([
      repository.countIssues({ ...day, severity: 'critical', status: 'open' }),
      repository.countIssues(day),
      repository.aggregateIssues({ ...day, limit: 1 }, 'lineId'),
      repository.listDowntime({ ...day, limit: 100 }),
    ]);
    const downtimeMinutes = downtime.reduce((sum, row) => sum + row.durationMinutes, 0);
    const topLine = byLine[0] ? labelFor('lineId', byLine[0].key) : null;
    sections.push(
      section(lang, 'production', s.productionHeadline(critical, total), [
        {
          label: s.criticalLabel,
          detail: s.criticalDetail(critical),
          href: 'issues?severity=critical&status=open',
          severity: critical > 0 ? 'critical' : 'info',
        },
        {
          label: s.issuesLabel,
          detail: s.issuesDetail(total, topLine),
          href: `issues?from=${today}&to=${today}`,
          severity: 'info',
        },
        {
          label: s.downtimeLabel,
          detail: s.downtimeDetail(minutesLabel(downtimeMinutes, lang), downtime.length),
          href: 'analytics',
          severity: downtimeMinutes > 60 ? 'warning' : 'info',
        },
      ]),
    );
    spoken.push(s.spokenProduction(critical, minutesLabel(downtimeMinutes, lang)));
  }

  // ---- maintenance ---------------------------------------------------------
  if (can('maintenance:read')) {
    const repository = getRepository();
    const week = { from: toIsoDate(addDays(now(), -6)), to: today, status: 'open', limit: 50 };
    const open = await repository.listMaintenance(week);
    sections.push(
      section(
        lang,
        'maintenance',
        open.length === 0 ? s.maintenanceNone : s.maintenanceHeadline(open.length),
        open.slice(0, 5).map((ticket) => ({
          label: `${ticket.id} ${ticket.assetName}`,
          detail: `${ticket.description} · ${labelFor('lineId', ticket.lineId)} · ${ticket.priority}`,
          href: 'analytics',
          severity: ticket.priority === 'high' ? 'warning' : 'info',
        })),
      ),
    );
  }

  const greeting = greetingFor(currentHour(), undefined, lang);

  return {
    generatedAt: new Date().toISOString(),
    date: today,
    language: lang,
    greeting,
    headline: t(lang, 'briefing.headline', { date: dateLabel(today, lang) }),
    sections,
    spoken: [t(lang, 'briefing.greeting', { greeting }), ...spoken.slice(0, 3)].join(' '),
  };
};
