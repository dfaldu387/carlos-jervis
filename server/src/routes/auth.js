import { Router } from 'express';
import { config } from '../config.js';
import {
  findUserByEmail,
  findUserById,
  verifyPassword,
  publicUser,
  demoAccounts,
  updateUserProfile,
  updateUserPassword,
} from '../auth/users.js';
import { requireAuth } from '../middleware/access.js';
import { createSession, destroySession, cookieOptions } from '../auth/sessions.js';
import { parseCookies } from '../auth/cookies.js';
import { createSsoHandlers } from '../auth/sso.js';
import { recordAudit } from '../security/audit.js';
import { logger } from '../utils/logger.js';

export const authRouter = Router();

/**
 * Login rate limiting (per client address).
 *
 * A small in-memory window blunts brute-force attempts. The same record backs
 * the account-agnostic lockout: too many failures from one address and every
 * attempt is refused until the window rolls over, so guessing is slow.
 */
const attempts = new Map();

const clientKey = (req) => req.ip ?? req.socket?.remoteAddress ?? 'unknown';

const windowMs = () => config.auth.loginWindowMinutes * 60 * 1000;

const tooMany = (key) => {
  const record = attempts.get(key);
  if (!record) return false;
  if (Date.now() > record.resetAt) {
    attempts.delete(key);
    return false;
  }
  return record.count >= config.auth.loginMaxAttempts;
};

const noteFailure = (key) => {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || now > record.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs() });
  } else {
    record.count += 1;
  }
};

const clearFailures = (key) => attempts.delete(key);

/** GET /api/auth/demo-accounts - the seeded demo logins, for the sign-in screen. */
authRouter.get('/demo-accounts', (_req, res) => {
  res.json({ accounts: demoAccounts(), demo: true });
});

/**
 * Single sign-on (Entra ID). Off unless config.sso is complete; the status
 * endpoint is public so the sign-in screen knows whether to show the button.
 * Flow and tests: src/auth/sso.js, test/sso.test.js.
 */
const sso = createSsoHandlers();
authRouter.get('/sso', sso.status);
authRouter.get('/sso/login', sso.login);
authRouter.get('/sso/callback', sso.callback);

/** POST /api/auth/login { email, password } */
authRouter.post('/login', (req, res) => {
  const key = clientKey(req);
  if (tooMany(key)) {
    res.status(429).json({
      error: 'too_many_requests',
      message: 'Too many sign-in attempts. Wait a few minutes and try again.',
    });
    return;
  }

  const email = String(req.body?.email ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!email || !password) {
    res.status(400).json({ error: 'request_error', message: 'Email and password are required.' });
    return;
  }

  const user = findUserByEmail(email);
  // Verify even when the user is unknown, against a throwaway hash, so the
  // response time does not reveal whether the email exists.
  const ok = user
    ? verifyPassword(password, user.passwordHash)
    : verifyPassword(password, 'scrypt$00$00');

  if (!user || !ok) {
    noteFailure(key);
    recordAudit({
      access: { userId: email || 'unknown', role: 'anonymous' },
      action: 'auth.login',
      resource: email || 'unknown',
      outcome: 'failed',
      detail: 'invalid credentials',
    });
    res.status(401).json({ error: 'unauthorized', message: 'Email or password is incorrect.' });
    return;
  }

  clearFailures(key);
  const token = createSession(user);
  res.cookie(config.auth.cookieName, token, cookieOptions());
  recordAudit({
    access: { userId: user.id, role: user.role },
    action: 'auth.login',
    resource: user.email,
    outcome: 'ok',
  });
  logger.info('User signed in', { userId: user.id, role: user.role });
  res.json({ user: publicUser(user) });
});

/** POST /api/auth/logout */
authRouter.post('/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[config.auth.cookieName];
  if (token) destroySession(token);
  if (req.access?.authenticated) {
    recordAudit({ access: req.access, action: 'auth.logout', resource: req.access.userId, outcome: 'ok' });
  }
  res.clearCookie(config.auth.cookieName, { path: '/' });
  res.json({ ok: true });
});

/** GET /api/auth/me - the current user, or 401. */
authRouter.get('/me', (req, res) => {
  if (!req.access?.authenticated) {
    res.status(401).json({ error: 'unauthorized', message: 'Not signed in.' });
    return;
  }
  const current = findUserById(req.access.userId);
  res.json({
    user: {
      ...(publicUser(current) ?? {
        id: req.access.userId,
        name: req.access.roleName,
        email: null,
        jobTitle: req.access.roleName,
        role: req.access.role,
        roleName: req.access.roleName,
        authSource: 'local',
      }),
      permissions: req.access.permissions,
      via: req.access.via,
    },
  });
});

/** PATCH /api/auth/profile - update the signed-in user's own name/title. */
authRouter.patch('/profile', requireAuth, (req, res) => {
  const { name, jobTitle } = req.body ?? {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 80)) {
    res.status(400).json({ error: 'request_error', message: 'Name must be 1 to 80 characters.' });
    return;
  }
  if (jobTitle !== undefined && (typeof jobTitle !== 'string' || jobTitle.length > 80)) {
    res.status(400).json({ error: 'request_error', message: 'Job title is too long.' });
    return;
  }
  const user = updateUserProfile(req.access.userId, { name, jobTitle });
  if (!user) {
    res.status(404).json({ error: 'not_found', message: 'User not found.' });
    return;
  }
  recordAudit({ access: req.access, action: 'profile.update', resource: user.email, outcome: 'ok' });
  res.json({ user: publicUser(user) });
});

/** POST /api/auth/change-password - verify the current password, set a new one. */
authRouter.post('/change-password', requireAuth, (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  const user = findUserById(req.access.userId);
  if (!user) {
    res.status(404).json({ error: 'not_found', message: 'User not found.' });
    return;
  }
  if (!user.passwordHash) {
    // SSO users have no local password; it is managed by the identity provider.
    res.status(400).json({ error: 'request_error', message: 'Your password is managed by your organisation sign-in.' });
    return;
  }
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    recordAudit({ access: req.access, action: 'password.change', resource: user.email, outcome: 'failed' });
    res.status(400).json({ error: 'request_error', message: 'Current password is incorrect.' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'request_error', message: 'New password must be at least 8 characters.' });
    return;
  }
  updateUserPassword(req.access.userId, newPassword);
  recordAudit({ access: req.access, action: 'password.change', resource: user.email, outcome: 'ok' });
  res.json({ ok: true });
});
