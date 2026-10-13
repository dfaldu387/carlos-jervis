import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.JERVIS_INTEGRATIONS_FILE = join(tmpdir(), `jervis-auth-${randomUUID()}.json`);

const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config.js');

let server;
let baseUrl;

const loginAs = async (email, password) => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = response.headers.get('set-cookie');
  return {
    status: response.status,
    cookie: setCookie ? setCookie.split(';')[0] : null,
    body: await response.json().catch(() => ({})),
  };
};

const withCookie = (path, cookie, options = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(options.headers ?? {}) },
  });

describe('Authentication', () => {
  before(async () => {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  test('health is public but protected routes need a session', async () => {
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/command-center`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/auth/me`)).status, 401);
  });

  test('a valid login opens a session the protected routes accept', async () => {
    const { status, cookie, body } = await loginAs('manager@jervis.local', 'Manager!2026');
    assert.equal(status, 200);
    assert.ok(cookie, 'login sets a session cookie');
    assert.equal(body.user.role, 'manager');
    assert.equal('passwordHash' in body.user, false, 'the hash is never returned');

    const me = await withCookie('/api/auth/me', cookie);
    assert.equal(me.status, 200);

    const board = await withCookie('/api/command-center', cookie);
    assert.equal(board.status, 200);
  });

  test('a wrong password is refused and sets no cookie', async () => {
    const { status, cookie } = await loginAs('manager@jervis.local', 'wrong-password');
    assert.equal(status, 401);
    assert.equal(cookie, null);
  });

  test('logout ends the session', async () => {
    const { cookie } = await loginAs('engineer@jervis.local', 'Engineer!2026');
    assert.equal((await withCookie('/api/auth/me', cookie)).status, 200);
    await withCookie('/api/auth/logout', cookie, { method: 'POST' });
    assert.equal((await withCookie('/api/auth/me', cookie)).status, 401);
  });

  test('a conversation cannot be read by another user', async () => {
    const manager = await loginAs('manager@jervis.local', 'Manager!2026');
    const ask = await withCookie('/api/chat', manager.cookie, {
      method: 'POST',
      body: JSON.stringify({ message: 'What problems did we have on Friday?' }),
    });
    const { sessionId } = await ask.json();
    assert.ok(sessionId);

    // The owner can replay it.
    assert.equal((await withCookie(`/api/chat/${sessionId}`, manager.cookie)).status, 200);

    // A different user cannot - and gets 404, not 403, so ids are not confirmed.
    const engineer = await loginAs('engineer@jervis.local', 'Engineer!2026');
    assert.equal((await withCookie(`/api/chat/${sessionId}`, engineer.cookie)).status, 404);
  });

  test('the header-role shortcut is refused when it is turned off', async () => {
    const original = config.auth.allowHeaderRole;
    config.auth.allowHeaderRole = false;
    try {
      const response = await fetch(`${baseUrl}/api/command-center`, {
        headers: { 'x-jervis-role': 'manager' },
      });
      assert.equal(response.status, 401, 'a client-asserted role is ignored in production mode');
    } finally {
      config.auth.allowHeaderRole = original;
    }
  });

  test('a user can edit their own profile', async () => {
    const { cookie } = await loginAs('viewer@jervis.local', 'Viewer!2026');
    const response = await withCookie('/api/auth/profile', cookie, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed Viewer', jobTitle: 'Line operator' }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.user.name, 'Renamed Viewer');
    assert.equal(body.user.jobTitle, 'Line operator');
  });

  test('password change requires the correct current password', async () => {
    const { cookie } = await loginAs('engineer@jervis.local', 'Engineer!2026');
    const bad = await withCookie('/api/auth/change-password', cookie, {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'LongEnough1' }),
    });
    assert.equal(bad.status, 400);

    const short = await withCookie('/api/auth/change-password', cookie, {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'Engineer!2026', newPassword: 'short' }),
    });
    assert.equal(short.status, 400);

    const ok = await withCookie('/api/auth/change-password', cookie, {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'Engineer!2026', newPassword: 'Engineer!2099' }),
    });
    assert.equal(ok.status, 200);

    const relog = await loginAs('engineer@jervis.local', 'Engineer!2099');
    assert.equal(relog.status, 200, 'the new password works');
  });

  test('profile and password endpoints require authentication', async () => {
    const profile = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    assert.equal(profile.status, 401);
  });

  // Runs last: it fills the per-IP login limiter for the window, which would
  // otherwise block the login-dependent tests above.
  test('repeated bad logins are rate limited', async () => {
    let sawLimit = false;
    for (let i = 0; i < config.auth.loginMaxAttempts + 1; i += 1) {
      const { status } = await loginAs('nobody@jervis.local', 'nope');
      if (status === 429) {
        sawLimit = true;
        break;
      }
    }
    assert.ok(sawLimit, 'the limiter returns 429 once the window fills');
  });
});
