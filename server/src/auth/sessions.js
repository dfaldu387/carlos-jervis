import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * Server-side session store (in-memory).
 *
 * The browser only ever holds the opaque token in an httpOnly cookie; the
 * session record - who it belongs to, when it expires - stays on the server
 * and can be revoked by deleting it. Tokens are 256 bits of randomness, so
 * they are a lookup key, not something to guess.
 */

const sessions = new Map();

const ttlMs = () => config.auth.sessionTtlHours * 60 * 60 * 1000;

export const createSession = (user) => {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(token, {
    token,
    userId: user.id,
    role: user.role,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + ttlMs(),
  });
  return token;
};

export const getSession = (token) => {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
};

export const destroySession = (token) => {
  if (token) sessions.delete(token);
};

/** Cookie attributes for the session token. */
export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: config.auth.cookieSecure,
  maxAge: ttlMs(),
});

export const resetSessions = () => sessions.clear();
