import { Router } from 'express';
import { requirePermission } from '../middleware/access.js';
import { recordAudit } from '../security/audit.js';
import { mailProvider } from '../secretary/provider.js';
import { draftReply } from '../secretary/drafts.js';
import { composeBriefing } from '../secretary/briefing.js';
import { createTask, deleteTask, getTask, listTasks, updateTask } from '../secretary/tasks.js';
import { normalizeLanguage } from '../agent/i18n.js';

export const secretaryRouter = Router();

/**
 * Secretary API: mailbox, calendar, tasks and the daily briefing.
 *
 * Every route sits behind requireAuth (mounted in app.js) and the specific
 * permission the data needs. Reads and writes are both audited. Sending mail
 * is the one action with a side effect outside Jervis, so it demands an
 * explicit `confirm: true` in the body on top of the mail:write permission -
 * a draft can never go out by accident.
 */

const MAIL_FILTERS = new Set(['all', 'unread', 'needsReply', 'flagged']);

const notFound = (res) => res.status(404).json({ error: 'not_found', message: 'No such item.' });

/** GET /api/secretary/mail?filter=all|unread|needsReply|flagged&q=&limit= */
secretaryRouter.get('/mail', requirePermission('mail:read'), async (req, res, next) => {
  try {
    const filter = MAIL_FILTERS.has(String(req.query.filter)) ? String(req.query.filter) : 'all';
    const q = String(req.query.q ?? '').trim().slice(0, 120);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 50) || 50));
    const provider = mailProvider();
    const result = await provider.listMail({ filter, q, limit });
    recordAudit({
      access: req.access,
      action: 'mail.read',
      resource: 'inbox',
      outcome: 'ok',
      detail: `filter=${filter}${q ? ` q="${q}"` : ''} (${result.total} matches)`,
    });
    res.json({
      items: result.items,
      total: result.total,
      unread: result.unread,
      needsReply: result.needsReply,
      flagged: result.flagged,
      mode: provider.mode,
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/secretary/mail/:id - one message with its body. Marks nothing. */
secretaryRouter.get('/mail/:id', requirePermission('mail:read'), async (req, res, next) => {
  try {
    const item = await mailProvider().getMail(req.params.id);
    if (!item) return notFound(res);
    recordAudit({ access: req.access, action: 'mail.read', resource: item.id, outcome: 'ok', detail: item.subject });
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/secretary/mail/:id { read?, flagged? } */
secretaryRouter.patch('/mail/:id', requirePermission('mail:write'), async (req, res, next) => {
  try {
    const { read, flagged } = req.body ?? {};
    if (read !== undefined && typeof read !== 'boolean') {
      res.status(400).json({ error: 'request_error', message: 'read must be a boolean.' });
      return;
    }
    if (flagged !== undefined && typeof flagged !== 'boolean') {
      res.status(400).json({ error: 'request_error', message: 'flagged must be a boolean.' });
      return;
    }
    const item = await mailProvider().updateMail(req.params.id, { read, flagged });
    if (!item) return notFound(res);
    recordAudit({
      access: req.access,
      action: 'mail.update',
      resource: item.id,
      outcome: 'ok',
      detail: JSON.stringify({ read, flagged }),
    });
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

/** POST /api/secretary/mail/:id/draft { instructions?, language? } - never sends. */
secretaryRouter.post('/mail/:id/draft', requirePermission('mail:read'), async (req, res, next) => {
  try {
    const mail = await mailProvider().getMail(req.params.id);
    if (!mail) return notFound(res);
    const instructions = String(req.body?.instructions ?? '').trim().slice(0, 600);
    const language = normalizeLanguage(req.body?.language ?? 'en');
    const draft = await draftReply(mail, { instructions, language });
    recordAudit({
      access: req.access,
      action: 'mail.draft',
      resource: mail.id,
      outcome: 'ok',
      detail: `${draft.provider}${instructions ? ', with instructions' : ''}`,
    });
    res.json({ draft: { subject: draft.subject, body: draft.body, tone: draft.tone, language: draft.language, provider: draft.provider } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/secretary/mail/:id/reply { body, confirm }
 * Requires confirm === true. Mock mode simulates the send and marks the
 * message replied; live mode would call Graph /reply once it is wired.
 */
secretaryRouter.post('/mail/:id/reply', requirePermission('mail:write'), async (req, res, next) => {
  try {
    const provider = mailProvider();
    const mail = await provider.getMail(req.params.id);
    if (!mail) return notFound(res);

    const body = String(req.body?.body ?? '').trim();
    if (req.body?.confirm !== true) {
      recordAudit({
        access: req.access,
        action: 'mail.reply',
        resource: mail.id,
        outcome: 'refused',
        detail: 'confirmation_required',
      });
      res.status(400).json({
        error: 'confirmation_required',
        message: 'Sending a reply needs an explicit confirmation (confirm: true).',
      });
      return;
    }
    if (!body) {
      res.status(400).json({ error: 'request_error', message: 'body is required.' });
      return;
    }

    const result = await provider.sendReply(mail.id, { body });
    recordAudit({
      access: req.access,
      action: 'mail.reply',
      resource: mail.id,
      outcome: result.mode === 'live' ? 'sent' : 'simulated',
      detail: mail.subject,
    });
    res.json({ ok: true, mode: result.mode, id: mail.id });
  } catch (error) {
    next(error);
  }
});

/** GET /api/secretary/calendar?day=today|tomorrow|YYYY-MM-DD */
secretaryRouter.get('/calendar', requirePermission('calendar:read'), async (req, res, next) => {
  try {
    const day = String(req.query.day ?? 'today');
    const result = await mailProvider().listEvents({ day });
    recordAudit({ access: req.access, action: 'calendar.read', resource: result.day, outcome: 'ok', detail: `${result.items.length} events` });
    res.json({ items: result.items, day: result.day });
  } catch (error) {
    next(error);
  }
});

/** GET /api/secretary/tasks?status=open|done|all */
secretaryRouter.get('/tasks', requirePermission('tasks:write'), (req, res) => {
  const status = ['open', 'done', 'all'].includes(String(req.query.status)) ? String(req.query.status) : 'open';
  const items = listTasks({ status });
  recordAudit({ access: req.access, action: 'task.read', resource: status, outcome: 'ok', detail: `${items.length} tasks` });
  res.json({ items, status });
});

/** POST /api/secretary/tasks { title, dueAt?, relatedMailId? } */
secretaryRouter.post('/tasks', requirePermission('tasks:write'), (req, res, next) => {
  try {
    const { title, dueAt = null, relatedMailId = null } = req.body ?? {};
    const item = createTask({ title, dueAt, relatedMailId, source: relatedMailId ? 'mail' : 'manual' }, req.access.userId);
    recordAudit({ access: req.access, action: 'task.create', resource: item.id, outcome: 'ok', detail: item.title });
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/secretary/tasks/:id { status?, title?, dueAt? } */
secretaryRouter.patch('/tasks/:id', requirePermission('tasks:write'), (req, res, next) => {
  try {
    if (!getTask(req.params.id)) return notFound(res);
    const { status, title, dueAt } = req.body ?? {};
    const item = updateTask(req.params.id, { status, title, dueAt });
    recordAudit({
      access: req.access,
      action: 'task.update',
      resource: item.id,
      outcome: 'ok',
      detail: JSON.stringify({ status, title, dueAt }),
    });
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/secretary/tasks/:id */
secretaryRouter.delete('/tasks/:id', requirePermission('tasks:write'), (req, res) => {
  const removed = deleteTask(req.params.id);
  if (!removed) return notFound(res);
  recordAudit({ access: req.access, action: 'task.delete', resource: req.params.id, outcome: 'ok' });
  res.json({ ok: true });
});

/** GET /api/secretary/briefing?language=en|de */
secretaryRouter.get('/briefing', requirePermission('calendar:read'), async (req, res, next) => {
  try {
    const language = normalizeLanguage(req.query.language ?? 'en');
    const briefing = await composeBriefing({ access: req.access, language });
    recordAudit({
      access: req.access,
      action: 'briefing.read',
      resource: briefing.date,
      outcome: 'ok',
      detail: briefing.sections.map((section) => section.id).join(','),
    });
    res.json(briefing);
  } catch (error) {
    next(error);
  }
});
