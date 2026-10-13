import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

let server;
let baseUrl;

const call = async (path, options = {}) => {
  // The dev/test header-role path stands in for a signed-in session; a test
  // that needs a different role overrides x-jervis-role in its own headers.
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-jervis-role': 'manager', ...(options.headers ?? {}) },
  });
  return { status: response.status, body: await response.json() };
};

describe('HTTP API', () => {
  before(async () => {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  test('health reports the active data source', async () => {
    const { status, body } = await call('/api/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.dataSource, 'memory');
    assert.ok(body.dataset.counts.issues > 0);
  });

  test('chat returns an answer and keeps the session', async () => {
    const first = await call('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'What problems did we have on Friday?' }),
    });
    assert.equal(first.status, 200);
    assert.ok(first.body.sessionId);

    const follow = await call('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId: first.body.sessionId, message: 'which models were affected?' }),
    });
    assert.equal(follow.body.sessionId, first.body.sessionId);

    const history = await call(`/api/chat/${first.body.sessionId}`);
    assert.equal(history.body.turns.length, 2);
  });

  test('chat rejects an empty message', async () => {
    const { status } = await call('/api/chat', { method: 'POST', body: JSON.stringify({ message: '  ' }) });
    assert.equal(status, 400);
  });

  test('overview feeds the dashboard', async () => {
    const { status, body } = await call('/api/summaries/overview?days=7');
    assert.equal(status, 200);
    assert.equal(body.period.days, 7);
    assert.ok(body.trend.length > 0);
    assert.ok(body.byShift.length > 0);
  });

  test('shift summary answers without a question', async () => {
    const { status, body } = await call('/api/summaries/shift?shift=S2');
    assert.equal(status, 200);
    assert.equal(body.interpretation.filters.shift, 'S2');
  });

  test('connector registry states the integration mode of each system', async () => {
    const { body } = await call('/api/sources');
    const ids = body.connectors.map((connector) => connector.id);
    for (const expected of ['databricks', 'powerbi', 'integral_portal', 'mqtt']) {
      assert.ok(ids.includes(expected), `${expected} should be registered`);
    }
    assert.ok(body.connectors.every((connector) => ['live', 'mock', 'planned'].includes(connector.mode)));
  });

  test('audit trail is manager-only', async () => {
    const asViewer = await call('/api/audit', { headers: { 'x-jervis-role': 'viewer' } });
    assert.equal(asViewer.status, 403);

    const asManager = await call('/api/audit', { headers: { 'x-jervis-role': 'manager' } });
    assert.equal(asManager.status, 200);
    assert.ok(Array.isArray(asManager.body.entries));
  });

  test('voice config reports the tts provider, and TTS is 501 when unconfigured', async () => {
    const cfg = await call('/api/voice/config', { headers: { 'x-jervis-role': 'manager' } });
    assert.equal(cfg.status, 200);
    assert.ok(cfg.body.tts);
    // No ElevenLabs key in the test env, so the browser voice is reported.
    assert.equal(cfg.body.tts.provider, 'browser');

    const tts = await call('/api/voice/tts', {
      method: 'POST',
      headers: { 'x-jervis-role': 'manager' },
      body: JSON.stringify({ text: 'hello' }),
    });
    assert.equal(tts.status, 501);
  });
});
