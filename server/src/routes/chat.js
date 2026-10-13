import { Router } from 'express';
import { answerQuestion } from '../agent/orchestrator.js';
import { appendTurn, ensureSession, getSession } from '../data/conversations.js';
import { recordQuery } from '../security/audit.js';
import { normalizeLanguage } from '../agent/i18n.js';

export const chatRouter = Router();

/** POST /api/chat - ask Jervis a question. */
chatRouter.post('/', async (req, res, next) => {
  try {
    const question = String(req.body?.message ?? '').trim();
    if (!question) {
      res.status(400).json({ error: 'request_error', message: 'message is required' });
      return;
    }
    if (question.length > 600) {
      res.status(400).json({ error: 'request_error', message: 'message is too long (600 chars max)' });
      return;
    }

    // Resolve the session, but never let one user continue another's: a
    // sessionId that belongs to someone else starts a fresh conversation
    // rather than leaking the prior turns.
    const existing = getSession(req.body?.sessionId);
    const owned = existing && existing.meta?.userId === req.access.userId ? existing : null;
    const session = owned ?? ensureSession(undefined, { role: req.access.role, userId: req.access.userId });
    // An explicit language wins over detection; otherwise the question's own
    // wording decides and result.language reports what was used.
    const language = req.body?.language ? normalizeLanguage(req.body.language) : undefined;
    const result = await answerQuestion({
      question,
      access: req.access,
      context: session.context,
      language,
    });

    appendTurn(session, { question, result, role: req.access.role });
    recordQuery({ question, access: req.access, result });

    res.json({
      sessionId: session.id,
      ...result,
      access: { role: req.access.role, roleName: req.access.roleName },
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/chat/:sessionId - replay a conversation. */
chatRouter.get('/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session || session.meta?.userId !== req.access.userId) {
    // Same response whether it does not exist or belongs to someone else, so
    // the endpoint does not confirm another user's session ids.
    res.status(404).json({ error: 'not_found', message: 'Unknown session' });
    return;
  }
  res.json({
    sessionId: session.id,
    createdAt: session.createdAt,
    context: session.context,
    turns: session.turns,
  });
});
