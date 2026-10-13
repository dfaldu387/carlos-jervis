import { newId } from '../utils/ids.js';

/**
 * Conversation store (in-memory).
 *
 * Holds the turn history plus the small amount of carried context that lets a
 * follow-up like "and the late shift?" resolve against the previous question.
 * Moves to the database with the rest of the persistence layer.
 */

const sessions = new Map();

export const createSession = (meta = {}) => {
  const session = {
    id: newId('sess'),
    createdAt: new Date().toISOString(),
    meta,
    turns: [],
    context: { lastTimeframe: null, lastLineId: null },
  };
  sessions.set(session.id, session);
  return session;
};

export const getSession = (id) => (id ? sessions.get(id) ?? null : null);

export const ensureSession = (id, meta) => getSession(id) ?? createSession(meta);

export const appendTurn = (session, turn) => {
  session.turns.push({ ...turn, at: new Date().toISOString() });

  const period = turn.result?.interpretation?.period;
  if (period && !period.assumed) {
    session.context.lastTimeframe = period;
  }
  const line = turn.result?.interpretation?.filters?.line;
  if (line) {
    session.context.lastLineId = turn.result.interpretation.filters.lineId ?? session.context.lastLineId;
  }
  return session;
};

export const listSessions = () =>
  [...sessions.values()].map((session) => ({
    id: session.id,
    createdAt: session.createdAt,
    turns: session.turns.length,
  }));

/** Conversations owned by one user, newest activity first, with a preview. */
export const listSessionsForUser = (userId) =>
  [...sessions.values()]
    .filter((session) => session.meta?.userId === userId && session.turns.length > 0)
    .map((session) => {
      const first = session.turns[0];
      const last = session.turns[session.turns.length - 1];
      return {
        id: session.id,
        title: first?.question ?? 'New conversation',
        preview: first?.result?.answer?.headline ?? first?.question ?? '',
        messageCount: session.turns.length,
        createdAt: session.createdAt,
        updatedAt: last?.at ?? session.createdAt,
      };
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
