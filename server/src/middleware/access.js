import { config } from '../config.js';
import { resolveAccess } from '../security/roles.js';
import { parseCookies } from '../auth/cookies.js';
import { getSession } from '../auth/sessions.js';
import { findUserById } from '../auth/users.js';

/**
 * Access middleware.
 *
 * Authorization is resolved on the server, in this order:
 *   1. A valid session cookie -> the authenticated user's role. This is the
 *      real path the browser uses.
 *   2. An x-jervis-role header -> only honoured when config.auth.allowHeaderRole
 *      is on (development and test). It is refused in production so a client
 *      can never assert its own role there.
 *
 * Downstream code reads req.access only; it is null for an unauthenticated
 * request, and requireAuth / requirePermission turn that into the right status.
 */
export const attachAccess = (req, _res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const session = getSession(cookies[config.auth.cookieName]);

  if (session) {
    const user = findUserById(session.userId);
    if (user) {
      req.access = { ...resolveAccess(user.role, user.id), authenticated: true, via: 'session' };
      req.sessionToken = session.token;
      return next();
    }
  }

  if (config.auth.allowHeaderRole) {
    const roleId = req.header('x-jervis-role') ?? req.body?.role ?? req.query?.role;
    if (roleId) {
      const userId = req.header('x-jervis-user') ?? 'demo-user';
      req.access = { ...resolveAccess(roleId, userId), authenticated: true, via: 'header' };
      return next();
    }
  }

  req.access = null;
  next();
};

/** Reject a request that carries no authenticated access. */
export const requireAuth = (req, res, next) => {
  if (!req.access?.authenticated) {
    res.status(401).json({ error: 'unauthorized', message: 'Sign in to continue.' });
    return;
  }
  next();
};

export const requirePermission = (permission) => (req, res, next) => {
  if (!req.access?.authenticated) {
    res.status(401).json({ error: 'unauthorized', message: 'Sign in to continue.' });
    return;
  }
  if (!req.access.permissions.includes(permission)) {
    res.status(403).json({
      error: 'forbidden',
      message: `Role "${req.access.role}" does not hold the "${permission}" permission.`,
    });
    return;
  }
  next();
};
