import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Point the store at a throwaway file before any module reads it.
process.env.JERVIS_INTEGRATIONS_FILE = join(tmpdir(), `jervis-int-${randomUUID()}.json`);

const { createApp } = await import('../src/app.js');
const { resetStore } = await import('../src/integrations/store.js');

let server;
let baseUrl;

const call = async (path, { role = 'manager', ...options } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-jervis-role': role, ...(options.headers ?? {}) },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

describe('Integrations API', () => {
  before(async () => {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());
  beforeEach(() => resetStore());

  test('lists every integration with masked secrets', async () => {
    const { status, body } = await call('/api/integrations');
    assert.equal(status, 200);
    assert.ok(body.integrations.length >= 5);

    const databricks = body.integrations.find((item) => item.id === 'databricks');
    const token = databricks.fields.find((field) => field.key === 'token');
    assert.equal(token.secret, true);
    assert.equal('value' in token, false, 'a secret field must never carry its value');
  });

  test('non-managers cannot read or change integration settings', async () => {
    assert.equal((await call('/api/integrations', { role: 'engineer' })).status, 403);
    assert.equal((await call('/api/integrations', { role: 'viewer' })).status, 403);

    const write = await call('/api/integrations/databricks', {
      role: 'engineer',
      method: 'PUT',
      body: JSON.stringify({ values: { host: 'evil.example' } }),
    });
    assert.equal(write.status, 403);
  });

  test('saving credentials flips configured but not live until enabled', async () => {
    const save = await call('/api/integrations/databricks', {
      method: 'PUT',
      body: JSON.stringify({
        values: { host: 'adb-1.azuredatabricks.net', token: 'dapiSECRET123', warehouseId: 'wh-1' },
      }),
    });
    assert.equal(save.status, 200);
    assert.equal(save.body.integration.configured, true);
    assert.equal(save.body.integration.live, false, 'configured is not live until enabled');

    const token = save.body.integration.fields.find((field) => field.key === 'token');
    assert.equal(token.set, true);
    assert.equal(token.hint, '····T123');

    const enable = await call('/api/integrations/databricks', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(enable.body.integration.live, true);
    assert.equal(enable.body.integration.mode, 'live');
  });

  test('an empty secret on resubmit keeps the stored one', async () => {
    await call('/api/integrations/integral_portal', {
      method: 'PUT',
      body: JSON.stringify({ values: { baseUrl: 'https://p.internal', apiKey: 'KEY-9999' } }),
    });
    // Resubmit without the secret, as the UI does when the field is untouched.
    const again = await call('/api/integrations/integral_portal', {
      method: 'PUT',
      body: JSON.stringify({ values: { baseUrl: 'https://p2.internal', apiKey: '' } }),
    });
    const key = again.body.integration.fields.find((field) => field.key === 'apiKey');
    assert.equal(key.set, true, 'the secret survives a resubmit with an empty field');
    assert.equal(key.hint, '····9999');
    const base = again.body.integration.fields.find((field) => field.key === 'baseUrl');
    assert.equal(base.value, 'https://p2.internal');
  });

  test('test connection reports mock mode when nothing is configured', async () => {
    const { status, body } = await call('/api/integrations/databricks/test', { method: 'POST' });
    assert.equal(status, 200);
    assert.equal(body.result.mode, 'mock');
    assert.equal(body.result.ok, false);
  });

  test('configuring a connector shows up in the public source registry', async () => {
    await call('/api/integrations/mqtt', {
      method: 'PUT',
      body: JSON.stringify({ values: { brokerUrl: 'mqtt://b.internal:1883' }, enabled: true }),
    });
    const { body } = await call('/api/sources');
    const mqtt = body.connectors.find((item) => item.id === 'mqtt');
    assert.equal(mqtt.mode, 'live');
  });

  test('integration changes are written to the audit event log', async () => {
    await call('/api/integrations/mqtt', {
      method: 'PUT',
      body: JSON.stringify({ values: { brokerUrl: 'mqtt://b.internal:1883' }, enabled: true }),
    });
    const { body } = await call('/api/audit');
    const event = body.events.find((item) => item.action === 'integration.update');
    assert.ok(event, 'an integration.update event was recorded');
    assert.equal(event.resource, 'mqtt');
  });
});
