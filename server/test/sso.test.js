import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';

process.env.JERVIS_INTEGRATIONS_FILE = join(tmpdir(), `jervis-sso-${randomUUID()}.json`);

const { createApp } = await import('../src/app.js');
const { config, ssoEnabled } = await import('../src/config.js');
const { attachAccess } = await import('../src/middleware/access.js');
const { authRouter } = await import('../src/routes/auth.js');
const { listEvents } = await import('../src/security/audit.js');
const { findUserById } = await import('../src/auth/users.js');
const {
  createSsoHandlers,
  mapRole,
  emailAllowed,
  sanitizeNext,
  sealState,
  openState,
  SsoError,
  SSO_STATE_COOKIE,
} = await import('../src/auth/sso.js');

/**
 * Nothing here talks to Microsoft: discovery and the token exchange are
 * replaced with fakes through createSsoHandlers({ exchange, discover }).
 */

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const GROUP_MANAGERS = 'g-managers';
const GROUP_ENGINEERS = 'g-engineers';

const stubbedSso = () => ({
  provider: 'entra',
  tenantId: TENANT,
  clientId: CLIENT,
  clientSecret: 'super-secret-client-secret',
  redirectUri: 'http://127.0.0.1:5180/api/auth/sso/callback',
  roleMap: { [GROUP_MANAGERS]: 'manager', [GROUP_ENGINEERS]: 'engineer' },
  defaultRole: 'viewer',
  allowedDomains: [],
});

const disabledSso = () => ({
  provider: '',
  tenantId: '',
  clientId: '',
  clientSecret: '',
  redirectUri: 'http://127.0.0.1:5180/api/auth/sso/callback',
  roleMap: {},
  defaultRole: 'viewer',
  allowedDomains: [],
});

const fakeDiscover = async () => ({
  tenantId: TENANT,
  issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  authorizationEndpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
  tokenEndpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
  jwks: null,
});

// The fake exchange hands back whatever claims the test staged, after
// recording what the callback passed in (code, verifier, nonce).
let stagedClaims = null;
let stagedError = null;
let lastExchange = null;
const fakeExchange = async (params) => {
  lastExchange = params;
  if (stagedError) throw stagedError;
  return stagedClaims;
};

const listen = async (app) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
};

const cookieNamed = (response, name) =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .find((pair) => pair.startsWith(`${name}=`)) ?? null;

const rawCookieNamed = (response, name) =>
  response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`)) ?? null;

const get = (baseUrl, path, cookie) =>
  fetch(`${baseUrl}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });

/** Run /sso/login and return the state from the redirect plus the sealed cookie. */
const startLogin = async (baseUrl, query = '') => {
  const response = await get(baseUrl, `/api/auth/sso/login${query}`);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  return {
    location,
    state: location.searchParams.get('state'),
    stateCookie: cookieNamed(response, SSO_STATE_COOKIE),
    rawStateCookie: rawCookieNamed(response, SSO_STATE_COOKIE),
  };
};

describe('SSO configuration and pure helpers', () => {
  test('ssoEnabled needs provider, tenant, client id and secret', () => {
    config.sso = disabledSso();
    assert.equal(ssoEnabled(), false);
    config.sso = { ...stubbedSso(), clientSecret: '' };
    assert.equal(ssoEnabled(), false);
    config.sso = { ...stubbedSso(), provider: 'okta' };
    assert.equal(ssoEnabled(), false);
    config.sso = stubbedSso();
    assert.equal(ssoEnabled(), true);
  });

  test('mapRole maps group ids and app roles, most privileged wins, default otherwise', () => {
    const options = { roleMap: { [GROUP_MANAGERS]: 'manager', [GROUP_ENGINEERS]: 'engineer', 'Jervis.Viewer': 'viewer' } };
    assert.equal(mapRole({ groups: [GROUP_ENGINEERS] }, options), 'engineer');
    assert.equal(mapRole({ groups: ['other', GROUP_ENGINEERS, GROUP_MANAGERS] }, options), 'manager');
    assert.equal(mapRole({ roles: ['Jervis.Viewer'] }, options), 'viewer');
    assert.equal(mapRole({ roles: 'Jervis.Viewer' }, options), 'viewer');
    assert.equal(mapRole({ groups: ['unmapped'] }, options), 'viewer');
    assert.equal(mapRole({}, { ...options, defaultRole: 'engineer' }), 'engineer');
    assert.equal(mapRole({}, { ...options, defaultRole: 'admin' }), 'viewer', 'unknown default falls back to viewer');
    assert.equal(mapRole({ groups: ['x'] }, { roleMap: { x: 'superuser' } }), 'viewer', 'unknown target role is ignored');
  });

  test('emailAllowed filters on the domain allow-list only when one is set', () => {
    assert.equal(emailAllowed('someone@example.com', []), true);
    assert.equal(emailAllowed(null, []), true);
    assert.equal(emailAllowed('someone@example.com', ['example.com']), true);
    assert.equal(emailAllowed('Someone@EXAMPLE.com', ['example.com']), true);
    assert.equal(emailAllowed('someone@evil.com', ['example.com', 'partner.de']), false);
    assert.equal(emailAllowed(null, ['example.com']), false);
    assert.equal(emailAllowed('no-at-sign', ['example.com']), false);
  });

  test('sanitizeNext keeps same-origin paths only', () => {
    assert.equal(sanitizeNext('/dashboards?tab=1'), '/dashboards?tab=1');
    assert.equal(sanitizeNext('https://evil.example/x'), '/');
    assert.equal(sanitizeNext('//evil.example'), '/');
    assert.equal(sanitizeNext('/\\evil.example'), '/');
    assert.equal(sanitizeNext(undefined), '/');
  });

  test('the sealed state cookie round-trips, expires and cannot be tampered with', () => {
    config.sso = stubbedSso();
    const sealed = sealState({ state: 's', nonce: 'n', verifier: 'v', next: '/', exp: Date.now() + 1000 });
    assert.deepEqual(openState(sealed).state, 's');
    assert.equal(openState(`${sealed}x`), null);
    assert.equal(openState('garbage'), null);
    assert.equal(openState(sealState({ state: 's', exp: Date.now() - 1 })), null);
    config.sso = { ...stubbedSso(), clientSecret: 'another-secret' };
    assert.equal(openState(sealed), null, 'a different secret cannot open it');
  });
});

describe('SSO endpoints on the real app', () => {
  let server;
  let baseUrl;

  before(async () => {
    ({ server, baseUrl } = await listen(createApp()));
  });

  after(() => server?.close());

  test('/api/auth/sso reports disabled by default and login/callback are 404', async () => {
    config.sso = disabledSso();
    const status = await get(baseUrl, '/api/auth/sso');
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { enabled: false, provider: null, loginPath: null, label: null });
    assert.equal((await get(baseUrl, '/api/auth/sso/login')).status, 404);
    assert.equal((await get(baseUrl, '/api/auth/sso/callback?code=x&state=y')).status, 404);
  });

  test('/api/auth/sso reports enabled with a stubbed config', async () => {
    config.sso = stubbedSso();
    const status = await get(baseUrl, '/api/auth/sso');
    assert.deepEqual(await status.json(), {
      enabled: true,
      provider: 'entra',
      loginPath: '/api/auth/sso/login',
      label: 'Sign in with Microsoft',
    });
    config.sso = disabledSso();
  });

  test('demo password login still works and reports authSource local', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'viewer@jervis.local', password: 'Viewer!2026' }),
    });
    assert.equal(response.status, 200);
    const { user } = await response.json();
    assert.equal(user.authSource, 'local');
    const cookie = cookieNamed(response, config.auth.cookieName);
    const me = await (await get(baseUrl, '/api/auth/me', cookie)).json();
    assert.equal(me.user.authSource, 'local');
    assert.equal(me.user.role, 'viewer');
  });
});

describe('SSO flow with a fake exchange', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = express();
    app.use(attachAccess);
    const sso = createSsoHandlers({ exchange: fakeExchange, discover: fakeDiscover });
    app.get('/api/auth/sso', sso.status);
    app.get('/api/auth/sso/login', sso.login);
    app.get('/api/auth/sso/callback', sso.callback);
    app.use('/api/auth', authRouter);
    ({ server, baseUrl } = await listen(app));
  });

  beforeEach(() => {
    config.sso = stubbedSso();
    stagedClaims = null;
    stagedError = null;
    lastExchange = null;
  });

  after(() => server?.close());

  test('login redirects to Entra with PKCE, state, client id and redirect uri', async () => {
    const { location, state, rawStateCookie } = await startLogin(baseUrl);
    assert.equal(location.origin, 'https://login.microsoftonline.com');
    assert.ok(location.pathname.includes(TENANT));
    const params = location.searchParams;
    assert.equal(params.get('client_id'), CLIENT);
    assert.equal(params.get('redirect_uri'), config.sso.redirectUri);
    assert.equal(params.get('response_type'), 'code');
    assert.equal(params.get('response_mode'), 'query');
    assert.equal(params.get('scope'), 'openid profile email');
    assert.equal(params.get('code_challenge_method'), 'S256');
    assert.ok(params.get('code_challenge')?.length >= 43);
    assert.ok(state?.length >= 32);
    assert.ok(params.get('nonce'));

    assert.ok(rawStateCookie, 'a state cookie is set');
    assert.match(rawStateCookie, /HttpOnly/);
    assert.match(rawStateCookie, /SameSite=Lax/);
    assert.match(rawStateCookie, /Max-Age=600/);
    assert.match(rawStateCookie, /Path=\/api\/auth\/sso/);
  });

  test('login is 404 when SSO is disabled', async () => {
    config.sso = disabledSso();
    assert.equal((await get(baseUrl, '/api/auth/sso/login')).status, 404);
  });

  test('callback without a state cookie redirects to /?sso_error=state', async () => {
    const response = await get(baseUrl, '/api/auth/sso/callback?code=abc&state=whatever');
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/?sso_error=state');
    assert.equal(lastExchange, null, 'no exchange is attempted');
    assert.ok(listEvents({ limit: 20 }).some((event) => event.action === 'auth.sso.denied'));
  });

  test('callback with a mismatched state redirects to /?sso_error=state', async () => {
    const { stateCookie } = await startLogin(baseUrl);
    const response = await get(baseUrl, '/api/auth/sso/callback?code=abc&state=not-the-one', stateCookie);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/?sso_error=state');
    assert.equal(lastExchange, null);
  });

  test('a provider error or a missing code is reported without an exchange', async () => {
    let flow = await startLogin(baseUrl);
    let response = await get(
      baseUrl,
      `/api/auth/sso/callback?error=access_denied&error_description=secret&state=${flow.state}`,
      flow.stateCookie,
    );
    assert.equal(response.headers.get('location'), '/?sso_error=provider');

    flow = await startLogin(baseUrl);
    response = await get(baseUrl, `/api/auth/sso/callback?state=${flow.state}`, flow.stateCookie);
    assert.equal(response.headers.get('location'), '/?sso_error=code');
    assert.equal(lastExchange, null);
  });

  test('a successful callback upserts the user, opens a session and audits the login', async () => {
    stagedClaims = {
      oid: 'oid-mara',
      name: 'Mara Entra',
      preferred_username: 'mara.entra@example.com',
      groups: ['irrelevant', GROUP_MANAGERS],
    };
    const { state, stateCookie } = await startLogin(baseUrl, '?next=/dashboards');
    const response = await get(baseUrl, `/api/auth/sso/callback?code=the-code&state=${state}`, stateCookie);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/dashboards');

    assert.equal(lastExchange.code, 'the-code');
    assert.ok(lastExchange.verifier?.length >= 43, 'the PKCE verifier comes from the cookie');
    assert.ok(lastExchange.nonce, 'the nonce comes from the cookie');

    const sessionCookie = cookieNamed(response, config.auth.cookieName);
    assert.ok(sessionCookie, 'a session cookie is set');
    const cleared = rawCookieNamed(response, SSO_STATE_COOKIE);
    assert.ok(cleared && /Expires=Thu, 01 Jan 1970/.test(cleared), 'the state cookie is cleared');

    const user = findUserById('entra_oid-mara');
    assert.ok(user, 'the user is upserted under the oid');
    assert.equal(user.role, 'manager');
    assert.equal(user.email, 'mara.entra@example.com');
    assert.equal(user.authSource, 'entra');
    assert.equal(user.passwordHash, null);

    const me = await get(baseUrl, '/api/auth/me', sessionCookie);
    assert.equal(me.status, 200);
    const body = await me.json();
    assert.equal(body.user.authSource, 'entra');
    assert.equal(body.user.role, 'manager');
    assert.equal(body.user.name, 'Mara Entra');
    assert.ok(body.user.permissions.includes('finance:read'));
    assert.equal('passwordHash' in body.user, false);

    const event = listEvents({ limit: 20 }).find((entry) => entry.action === 'auth.sso.login');
    assert.ok(event, 'auth.sso.login is audited');
    assert.equal(event.userId, 'entra_oid-mara');
    assert.equal(event.role, 'manager');
    assert.equal(event.outcome, 'ok');
  });

  test('a second sign-in updates the same user and re-maps the role', async () => {
    stagedClaims = { oid: 'oid-mara', name: 'Mara Renamed', email: 'mara.entra@example.com', groups: [GROUP_ENGINEERS] };
    const { state, stateCookie } = await startLogin(baseUrl);
    const response = await get(baseUrl, `/api/auth/sso/callback?code=c&state=${state}`, stateCookie);
    assert.equal(response.headers.get('location'), '/');
    const user = findUserById('entra_oid-mara');
    assert.equal(user.name, 'Mara Renamed');
    assert.equal(user.role, 'engineer');
  });

  test('unmapped groups get the default role', async () => {
    stagedClaims = { oid: 'oid-nobody', email: 'nobody@example.com', groups: ['something-else'] };
    const { state, stateCookie } = await startLogin(baseUrl);
    await get(baseUrl, `/api/auth/sso/callback?code=c&state=${state}`, stateCookie);
    assert.equal(findUserById('entra_oid-nobody').role, 'viewer');
  });

  test('an email outside the allowed domains is denied', async () => {
    config.sso = { ...stubbedSso(), allowedDomains: ['example.com'] };
    stagedClaims = { oid: 'oid-outsider', email: 'outsider@other.org', groups: [GROUP_MANAGERS] };
    const { state, stateCookie } = await startLogin(baseUrl);
    const response = await get(baseUrl, `/api/auth/sso/callback?code=c&state=${state}`, stateCookie);
    assert.equal(response.headers.get('location'), '/?sso_error=domain');
    assert.equal(cookieNamed(response, config.auth.cookieName), null, 'no session cookie');
    assert.equal(findUserById('entra_oid-outsider'), null, 'no user is created');
    const event = listEvents({ limit: 5 }).find((entry) => entry.action === 'auth.sso.denied');
    assert.equal(event.detail, 'email domain not allowed');
  });

  test('a failed token exchange redirects with its short code and leaks nothing', async () => {
    stagedError = new SsoError('nonce', 'nonce mismatch eyJhbGciOi...');
    const { state, stateCookie } = await startLogin(baseUrl);
    const response = await get(baseUrl, `/api/auth/sso/callback?code=c&state=${state}`, stateCookie);
    assert.equal(response.headers.get('location'), '/?sso_error=nonce');
    assert.equal(cookieNamed(response, config.auth.cookieName), null);

    stagedError = new Error('socket hang up');
    const again = await startLogin(baseUrl);
    const fallback = await get(baseUrl, `/api/auth/sso/callback?code=c&state=${again.state}`, again.stateCookie);
    assert.equal(fallback.headers.get('location'), '/?sso_error=token');
  });

  test('claims without an oid are rejected', async () => {
    stagedClaims = { email: 'anon@example.com' };
    const { state, stateCookie } = await startLogin(baseUrl);
    const response = await get(baseUrl, `/api/auth/sso/callback?code=c&state=${state}`, stateCookie);
    assert.equal(response.headers.get('location'), '/?sso_error=claims');
  });

  test('a state cookie cannot be replayed', async () => {
    stagedClaims = { oid: 'oid-replay', email: 'replay@example.com' };
    const { state, stateCookie } = await startLogin(baseUrl);
    const first = await get(baseUrl, `/api/auth/sso/callback?code=c&state=${state}`, stateCookie);
    assert.equal(first.headers.get('location'), '/');
    // The browser drops the cleared cookie; a replay without it fails on state.
    const replay = await get(baseUrl, `/api/auth/sso/callback?code=c&state=${state}`);
    assert.equal(replay.headers.get('location'), '/?sso_error=state');
  });

  test('SSO users cannot change a local password', async () => {
    stagedClaims = { oid: 'oid-pw', email: 'pw@example.com' };
    const { state, stateCookie } = await startLogin(baseUrl);
    const response = await get(baseUrl, `/api/auth/sso/callback?code=c&state=${state}`, stateCookie);
    const sessionCookie = cookieNamed(response, config.auth.cookieName);
    const change = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({ currentPassword: 'x', newPassword: 'longenough1' }),
    });
    assert.equal(change.status, 400);
  });
});
