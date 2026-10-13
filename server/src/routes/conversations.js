import { Router } from 'express';
import { listSessionsForUser } from '../data/conversations.js';

export const conversationsRouter = Router();

/**
 * GET /api/conversations
 * The signed-in user's own conversations, for the history page. Ownership is
 * enforced here, not in the UI: a user only ever sees their own, and the full
 * transcript is fetched through GET /api/chat/:id, which applies the same
 * ownership check.
 */
conversationsRouter.get('/', (req, res) => {
  const search = String(req.query.q ?? '').trim().toLowerCase();
  let items = listSessionsForUser(req.access.userId);
  if (search) {
    items = items.filter(
      (item) => item.title.toLowerCase().includes(search) || item.preview.toLowerCase().includes(search),
    );
  }
  res.json({ items, total: items.length });
});
