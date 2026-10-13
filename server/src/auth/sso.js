import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config, ssoEnabled } from '../config.js';
import { ROLES } from '../security/roles.js';
import { recordAudit } from '../security/audit.js';
import { logger } from '../utils/logger.js';
import { parseCookies } from './cookies.js';
import { createSession, cookieOptions } from './sessions.js';
import { upsertExternalUser } from './users.js';

/**
 * Single sign-on with Microsoft Entra ID (OpenID Connect).
 *
 * Authorization-code flow with PKCE:
 *   1. GET /api/auth/sso/login   - mint state, nonce and PKCE verifier, seal
 *      them in a short-lived cookie, redirect to the Entra authorize endpoint.
 *   2. GET /api/auth/sso/callback - check the returned state against the
 *      cookie, swap the code for an id token (client secret + verifier),
 *      verify the token against the tenant's JWKS, map claims to a Jervis
 *      role, upsert the user and open a normal server-side session.
 *
 * The token exchange and verification are one injectable function
 * (`exchange`) so the flow can be tested end to end without Microsoft. Every
 * failure ends in a redirect to /?sso_error=<code>; token contents are never
 * echoed to the browser or the log.
 */

export const SSO_STATE_COOKIE = 'jervis_sso';
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_COOKIE_PATH = '/api/auth/sso';
const SCOPE = 'openid profile email';
const LABEL = 'Sign in with Microsoft';

/** Highest privilege first, so a user in several mapped groups gets the widest role. */
const ROLE_PRECEDENCE = ['manager', 'engineer', 'viewer'];

/** A failure with the short code that ends up in /?sso_error=<code>. */
export class SsoError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

// ---- role mapping and domain filtering -------------------------------------

/**
 * Map the id token's `groups` and `roles` claims to a Jervis role via the
 * configured role map ({ "<group id or app role value>": "<role>" }). When
 * several entries match, the most privileged wins; nothing matched (or an
 * unknown target role) falls back to the default role, which itself must be a
 * known role or 'viewer'.
 */
export const mapRole = (claims, { roleMap = config.sso.roleMap, defaultRole = config.sso.defaultRole } = {}) => {
  const values = [];
  for (const key of ['groups', 'roles']) {
    const claim = claims?.[key];
    if (Array.isArray(claim)) values.push(...claim.map(String));
    else if (typeof claim === 'string') values.push(claim);
  }
  const matched = new Set();
  for (const value of values) {
    const target = roleMap?.[value];
    if (typeof target === 'string' && ROLES[target]) matched.add(target);
  }
  const best = ROLE_PRECEDENCE.find((role) => matched.has(role));
  if (best) return best;
  return ROLES[defaultRole] ? defaultRole : 'viewer';
};

/** True when no domain allow-list is set, or the email's domain is on it. */
export const emailAllowed = (email, allowedDomains = config.sso.allowedDomains) => {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  const at = String(email ?? '').lastIndexOf('@');
  if (at < 0) return false;
  const domain = String(email).slice(at + 1).trim().toLowerCase();
  return allowedDomains.includes(domain);
};

/** Only same-origin paths may be used as the post-login destination. */
export const sanitizeNext = (value) => {
  if (typeof value !== 'string' || value.length > 512) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (/[\r\n]/.test(value)) return '/';
  return value;
};

/** Pick the user's email from the claims Entra issues (email, else a UPN-shaped username). */
const emailFromClaims = (claims) => {
  for (const key of ['email', 'preferred_username', 'upn']) {
    const value = claims?.[key];
    if (typeof value === 'string' && value.includes('@')) return value.trim();
  }
  return null;
};

// ---- sealed state cookie ---------------------------------------------------

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');

/**
 * The state cookie is encrypted (AES-256-GCM) with a key derived from the SSO
 * client secret, so the PKCE verifier survives a server restart without
 * being readable or forgeable from the browser side.
 */
const stateKey = () =>
  Buffer.from(hkdfSync('sha256', config.sso.clientSecret, 'jervis-sso', 'state-cookie', 32));

export const sealState = (payload) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', stateKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return `${base64url(iv)}.${base64url(body)}.${base64url(cipher.getAuthTag())}`;
};

export const openState = (sealed) => {
  if (typeof sealed !== 'string') return null;
  const [iv, body, tag] = sealed.split('.');
  if (!iv || !body || !tag) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', stateKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
    const payload = JSON.parse(plain.toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};

const stateCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  path: STATE_COOKIE_PATH,
  secure: config.auth.cookieSecure,
  maxAge: STATE_TTL_MS,
});

// ---- discovery and token exchange (the parts that talk to Microsoft) ------

let discoveryCache = null;

/** Forget the cached OpenID configuration and JWKS (tests, or a tenant change). */
export const resetSsoCache = () => {
  discoveryCache = null;
};

/**
 * Fetch the tenant's OpenID configuration once and keep it, together with a
 * remote JWKS resolver (jose caches the keys and refreshes on unknown kids).
 */
export const discoverEntra = async () => {
  if (discoveryCache?.tenantId === config.sso.tenantId) return discoveryCache;
  const url = `https://login.microsoftonline.com/${encodeURIComponent(config.sso.tenantId)}/v2.0/.well-known/openid-configuration`;
  const response = await fetch(url);
  if (!response.ok) throw new SsoError('discovery', `openid-configuration returned ${response.status}`);
  const doc = await response.json();
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new SsoError('discovery', 'openid-configuration is incomplete');
  }
  discoveryCache = {
    tenantId: config.sso.tenantId,
    issuer: doc.issuer,
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    jwks: createRemoteJWKSet(new URL(doc.jwks_uri)),
  };
  return discoveryCache;
};

/**
 * Default exchange: redeem the code at the token endpoint and verify the id
 * token's signature (tenant JWKS), issuer, audience, expiry and nonce. Returns
 * the verified claims only - the raw token never leaves this function.
 */
export const exchangeWithEntra = async ({ code, verifier, nonce }, discover = discoverEntra) => {
  const { tokenEndpoint, issuer, jwks } = await discover();
  const body = new URLSearchParams({
    client_id: config.sso.clientId,
    client_secret: config.sso.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.sso.redirectUri,
    code_verifier: verifier,
    scope: SCOPE,
  });
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new SsoError('token', `token endpoint returned ${response.status}`);
  const tokens = await response.json();
  if (typeof tokens.id_token !== 'string') throw new SsoError('token', 'no id_token in response');

  // A multi-tenant issuer ('common', 'organizations') is templated in the
  // discovery document; in that case the issuer is checked against the
  // token's own tenant id below instead of a fixed string.
  const templated = typeof issuer === 'string' && issuer.includes('{tenantid}');
  let payload;
  try {
    ({ payload } = await jwtVerify(tokens.id_token, jwks, {
      audience: config.sso.clientId,
      ...(templated ? {} : { issuer }),
    }));
  } catch (error) {
    throw new SsoError('token', `id_token rejected: ${error?.code ?? error?.name ?? 'verify'}`);
  }
  if (templated) {
    const expected = issuer.replace('{tenantid}', String(payload.tid ?? ''));
    if (!payload.tid || payload.iss !== expected) throw new SsoError('token', 'issuer mismatch');
  }
  if (!nonce || payload.nonce !== nonce) throw new SsoError('nonce', 'nonce mismatch');
  return payload;
};

// ---- express handlers ------------------------------------------------------

const denied = (code, resource, detail) =>
  recordAudit({
    access: { userId: resource ?? 'unknown', role: 'anonymous' },
    action: 'auth.sso.denied',
    resource: resource ?? 'unknown',
    outcome: 'denied',
    detail: detail ?? code,
  });

const failRedirect = (res, code) => res.redirect(302, `/?sso_error=${encodeURIComponent(code)}`);

/**
 * Build the three SSO handlers. `exchange({ code, verifier, nonce })` must
 * resolve to verified id-token claims; `discover()` to the tenant endpoints.
 * Both default to the live Entra implementations and are replaced in tests.
 */
export const createSsoHandlers = ({ exchange, discover = discoverEntra } = {}) => {
  const doExchange = exchange ?? ((params) => exchangeWithEntra(params, discover));

  /** GET /api/auth/sso - public: is SSO on, and where does the button go? */
  const status = (_req, res) => {
    const enabled = ssoEnabled();
    res.json({
      enabled,
      provider: enabled ? 'entra' : null,
      loginPath: enabled ? '/api/auth/sso/login' : null,
      label: enabled ? LABEL : null,
    });
  };

  /** GET /api/auth/sso/login?next=/path - start the authorization-code flow. */
  const login = async (req, res, next) => {
    if (!ssoEnabled()) {
      res.status(404).json({ error: 'not_found', message: 'Single sign-on is not configured.' });
      return;
    }
    try {
      const endpoints = await discover();
      const state = base64url(randomBytes(32));
      const nonce = base64url(randomBytes(32));
      const verifier = base64url(randomBytes(48));
      const challenge = base64url(createHash('sha256').update(verifier).digest());
      const destination = sanitizeNext(req.query?.next);

      res.cookie(
        SSO_STATE_COOKIE,
        sealState({ state, nonce, verifier, next: destination, exp: Date.now() + STATE_TTL_MS }),
        stateCookieOptions(),
      );

      const url = new URL(endpoints.authorizationEndpoint);
      url.searchParams.set('client_id', config.sso.clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('response_mode', 'query');
      url.searchParams.set('redirect_uri', config.sso.redirectUri);
      url.searchParams.set('scope', SCOPE);
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      res.redirect(302, url.toString());
    } catch (error) {
      logger.warn('SSO login could not start', { reason: error?.message });
      if (error instanceof SsoError) {
        failRedirect(res, error.code);
        return;
      }
      next(error);
    }
  };

  /** GET /api/auth/sso/callback?code&state - finish the flow and open a session. */
  const callback = async (req, res) => {
    if (!ssoEnabled()) {
      res.status(404).json({ error: 'not_found', message: 'Single sign-on is not configured.' });
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const stored = openState(cookies[SSO_STATE_COOKIE]);
    res.clearCookie(SSO_STATE_COOKIE, { path: STATE_COOKIE_PATH });

    const state = typeof req.query?.state === 'string' ? req.query.state : '';
    if (!stored || !state || stored.state !== state) {
      denied('state', 'unknown', 'state missing or mismatched');
      failRedirect(res, 'state');
      return;
    }
    if (typeof req.query?.error === 'string' && req.query.error) {
      // Entra reports e.g. access_denied or consent_required; only the code
      // itself is passed on, never the description.
      denied('provider', 'unknown', `provider error: ${req.query.error.slice(0, 64)}`);
      failRedirect(res, 'provider');
      return;
    }
    const code = typeof req.query?.code === 'string' ? req.query.code : '';
    if (!code) {
      denied('code', 'unknown', 'no authorization code');
      failRedirect(res, 'code');
      return;
    }

    let claims;
    try {
      claims = await doExchange({ code, verifier: stored.verifier, nonce: stored.nonce });
    } catch (error) {
      const reason = error instanceof SsoError ? error.code : 'token';
      logger.warn('SSO token exchange failed', { reason, detail: error?.message });
      denied(reason, 'unknown', `exchange failed: ${reason}`);
      failRedirect(res, reason);
      return;
    }

    const subject = typeof claims?.oid === 'string' ? claims.oid : '';
    const email = emailFromClaims(claims);
    if (!subject) {
      denied('claims', email ?? 'unknown', 'id token has no oid claim');
      failRedirect(res, 'claims');
      return;
    }
    if (!emailAllowed(email)) {
      denied('domain', email ?? subject, 'email domain not allowed');
      failRedirect(res, 'domain');
      return;
    }

    const role = mapRole(claims);
    const user = upsertExternalUser({
      source: 'entra',
      subject,
      email,
      name: typeof claims.name === 'string' ? claims.name : null,
      role,
    });

    const token = createSession(user);
    res.cookie(config.auth.cookieName, token, cookieOptions());
    recordAudit({
      access: { userId: user.id, role: user.role },
      action: 'auth.sso.login',
      resource: user.email ?? user.id,
      outcome: 'ok',
      detail: 'entra',
    });
    logger.info('User signed in via SSO', { userId: user.id, role: user.role });
    res.redirect(302, sanitizeNext(stored.next));
  };

  return { status, login, callback };
};
