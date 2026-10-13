import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { requireAuth } from '../middleware/access.js';
import { recordAudit, recordQuery } from '../security/audit.js';
import { resolveAccess } from '../security/roles.js';
import { answerQuestion } from '../agent/orchestrator.js';
import { normalizeLanguage } from '../agent/i18n.js';
import { appendTurn, ensureSession, getSession } from '../data/conversations.js';
import { automateMode, canRunAutomation, inboundSecret, publicFlows, triggerFlow } from '../automate/index.js';

export const automateRouter = Router();

/**
 * Power Automate routes.
 *
 *   GET  /api/automate/flows    the flows Jervis may start (signed-in users)
 *   POST /api/automate/trigger  start one, with an explicit confirm (manager,
 *                               or any role holding automate:run)
 *   POST /api/automate/inbound  a flow asks Jervis a question; authenticated
 *                               by the shared secret header only, never by a
 *                               session, and answered with a fixed engineer-
 *                               level service identity.
 *
 * The router is mounted without requireAuth so /inbound can use its own
 * check; the two user-facing routes add requireAuth themselves.
 */

const SERVICE_USER = 'power-automate';
const INBOUND_HEADER = 'x-jervis-automate-secret';

/** Equal-length digests so the comparison is constant time regardless of input length. */
const secretMatches = (given, expected) => {
  if (!given || !expected) return false;
  const a = createHash('sha256').update(String(given)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
};

/* Light in-memory rate limit for /inbound: sliding window per caller address. */
const inboundLimit = { max: 60, windowMs: 60_000 };
const inboundHits = new Map();

const inboundAllowed = (key) => {
  const now = Date.now();
  const hits = (inboundHits.get(key) ?? []).filter((at) => now - at < inboundLimit.windowMs);
  if (hits.length >= inboundLimit.max) {
    inboundHits.set(key, hits);
    return false;
  }
  hits.push(now);
  inboundHits.set(key, hits);
  return true;
};

/** Test hooks. */
export const resetInboundRateLimit = () => inboundHits.clear();
export const configureInboundRateLimit = ({ max, windowMs } = {}) => {
  if (Number.isFinite(max)) inboundLimit.max = max;
  if (Number.isFinite(windowMs)) inboundLimit.windowMs = windowMs;
};

const forbidden = (res, access) =>
  res.status(403).json({
    error: 'forbidden',
    message: `Role "${access.role}" may not start Power Automate flows (automate:run).`,
  });

/** GET /api/automate/flows */
automateRouter.get('/flows', requireAuth, (_req, res) => {
  res.json({ items: publicFlows(), mode: automateMode() });
});

/** POST /api/automate/trigger { flow, payload?, confirm } */
automateRouter.post('/trigger', requireAuth, async (req, res, next) => {
  try {
    if (!canRunAutomation(req.access)) return forbidden(res, req.access);
    const flow = String(req.body?.flow ?? '').trim();
    if (!flow) {
      res.status(400).json({ error: 'request_error', message: 'flow is required.' });
      return;
    }
    const known = publicFlows().some((entry) => entry.name === flow);
    if (!known) {
      res.status(404).json({ error: 'not_found', message: `Unknown flow "${flow}".` });
      return;
    }
    if (req.body?.confirm !== true) {
      recordAudit({ access: req.access, action: 'automate.trigger', resource: flow, outcome: 'refused', detail: 'confirmation_required' });
      res.status(400).json({
        error: 'confirmation_required',
        message: 'Starting a flow needs an explicit confirmation (confirm: true).',
      });
      return;
    }
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    const result = await triggerFlow({ name: flow, payload, access: req.access });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    next(error);
  }
});

/** POST /api/automate/inbound { question, language?, sessionId? } - header x-jervis-automate-secret */
automateRouter.post('/inbound', async (req, res, next) => {
  try {
    const expected = inboundSecret();
    if (!expected) {
      res.status(503).json({ error: 'automate_inbound_disabled', message: 'No inbound secret is configured for Power Automate.' });
      return;
    }
    if (!secretMatches(req.header(INBOUND_HEADER), expected)) {
      recordAudit({ access: null, action: 'automate.inbound', resource: 'question', outcome: 'refused', detail: 'bad secret' });
      res.status(401).json({ error: 'unauthorized', message: 'Invalid automate secret.' });
      return;
    }
    if (!inboundAllowed(req.ip ?? 'unknown')) {
      res.status(429).json({ error: 'rate_limited', message: 'Too many inbound requests; try again in a minute.' });
      return;
    }

    const question = String(req.body?.question ?? '').trim();
    if (!question) {
      res.status(400).json({ error: 'request_error', message: 'question is required.' });
      return;
    }
    if (question.length > 600) {
      res.status(400).json({ error: 'request_error', message: 'question is too long (600 chars max).' });
      return;
    }

    // Fixed service identity: never a real user, never more than an engineer.
    const access = { ...resolveAccess('engineer', SERVICE_USER), authenticated: true, via: 'automate' };
    const existing = getSession(req.body?.sessionId);
    const owned = existing && existing.meta?.userId === SERVICE_USER ? existing : null;
    const session = owned ?? ensureSession(undefined, { role: access.role, userId: SERVICE_USER, via: 'automate' });
    const language = req.body?.language ? normalizeLanguage(req.body.language) : undefined;

    const result = await answerQuestion({ question, access, context: session.context, language });
    appendTurn(session, { question, result, role: access.role });
    recordQuery({ question, access, result });
    recordAudit({
      access,
      action: 'automate.inbound',
      resource: result.interpretation?.intent ?? 'question',
      outcome: 'ok',
      detail: question.slice(0, 120),
    });

    res.json({ sessionId: session.id, ...result, access: { role: access.role, roleName: access.roleName } });
  } catch (error) {
    next(error);
  }
});
