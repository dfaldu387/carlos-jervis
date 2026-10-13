import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Isolate the on-disk stores before any module reads them.
process.env.JERVIS_INTEGRATIONS_FILE = join(tmpdir(), `jervis-automate-${randomUUID()}.json`);
process.env.JERVIS_TASKS_FILE = join(tmpdir(), `jervis-tasks-${randomUUID()}.json`);
process.env.JERVIS_DASHBOARDS_FILE = join(tmpdir(), `jervis-dash-${randomUUID()}.json`);
delete process.env.POWER_AUTOMATE_TRIGGER_URL;
delete process.env.POWER_AUTOMATE_INBOUND_SECRET;
delete process.env.POWER_AUTOMATE_FLOWS;

const { createApp } = await import('../src/app.js');
const { resetStore, saveSettings } = await import('../src/integrations/store.js');
const { setAutomateFetch, findFlow, listFlows, canRunAutomation, SAMPLE_FLOWS } = await import('../src/automate/index.js');
const { configureInboundRateLimit, resetInboundRateLimit } = await import('../src/routes/automate.js');
const { automateTrigger } = await import('../src/agent/tools/automate.js');
const { toolById } = await import('../src/agent/tools/index.js');

let server;
let baseUrl;

const call = async (path, { role = 'manager', ...options } = {}) => {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
  if (role) headers['x-jervis-role'] = role;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

const post = (path, body, options = {}) => call(path, { method: 'POST', body: JSON.stringify(body), ...options });

const TRIGGER_URL = 'https://prod-01.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=SIGNATURE';

const goLive = (extra = {}) =>
  saveSettings('power_automate', { values: { triggerUrl: TRIGGER_URL, ...extra }, enabled: true }, 'test');

describe('Power Automate API', () => {
  before(async () => {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    setAutomateFetch(null);
    server?.close();
  });

  beforeEach(() => {
    resetStore();
    resetInboundRateLimit();
    configureInboundRateLimit({ max: 60, windowMs: 60_000 });
    setAutomateFetch(null);
  });

  test('lists the sample flows in mock mode for any signed-in user', async () => {
    assert.equal((await call('/api/automate/flows', { role: null })).status, 401);
    const { status, body } = await call('/api/automate/flows', { role: 'viewer' });
    assert.equal(status, 200);
    assert.equal(body.mode, 'mock');
    assert.deepEqual(
      body.items.map((item) => item.name),
      ['escalate-quality-issue', 'request-maintenance-visit', 'daily-report-distribution'],
    );
    for (const item of body.items) {
      assert.equal(item.mode, 'mock');
      assert.ok(item.label);
      assert.ok(!('url' in item), 'flow URLs never reach the browser');
    }
  });

  test('a configured catalog replaces the samples', async () => {
    goLive({
      flowCatalog: JSON.stringify([
        { name: 'Notify Shift Leads', label: 'Notify the shift leads', url: 'https://prod-02.logic.azure.com/x' },
        { label: 'entry without a name is skipped' },
      ]),
    });
    const { body } = await call('/api/automate/flows');
    assert.equal(body.mode, 'live');
    assert.deepEqual(body.items.map((item) => item.name), ['notify-shift-leads']);
    assert.equal(listFlows()[0].url, 'https://prod-02.logic.azure.com/x');

    saveSettings('power_automate', { values: { flowCatalog: 'not json' } }, 'test');
    assert.equal(listFlows().length, SAMPLE_FLOWS.length, 'invalid JSON falls back to the samples');
  });

  test('refuses a trigger without confirm, and an unknown flow', async () => {
    const refused = await post('/api/automate/trigger', { flow: 'escalate-quality-issue' });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'confirmation_required');

    const unknown = await post('/api/automate/trigger', { flow: 'launch-rockets', confirm: true });
    assert.equal(unknown.status, 404);

    const missing = await post('/api/automate/trigger', { confirm: true });
    assert.equal(missing.status, 400);

    const audit = await call('/api/audit');
    const event = audit.body.events.find((item) => item.action === 'automate.trigger' && item.outcome === 'refused');
    assert.ok(event, 'the refusal is audited');
    assert.equal(event.resource, 'escalate-quality-issue');
  });

  test('is manager-only until automate:run exists on the roles', async () => {
    const viewer = await post('/api/automate/trigger', { flow: 'escalate-quality-issue', confirm: true }, { role: 'viewer' });
    assert.equal(viewer.status, 403);
    assert.equal(canRunAutomation({ role: 'manager', permissions: [] }), true);
    assert.equal(canRunAutomation({ role: 'engineer', permissions: [] }), false);
    assert.equal(canRunAutomation({ role: 'engineer', permissions: ['automate:run'] }), true, 'the permission string wins once roles carry it');
    assert.equal(canRunAutomation(null), false);
  });

  test('simulates the trigger in mock mode and audits it', async () => {
    const { status, body } = await post('/api/automate/trigger', {
      flow: 'request-maintenance-visit',
      payload: { assetId: 'AS-204', note: 'sensor overdue' },
      confirm: true,
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.mode, 'simulated');
    assert.match(body.runId, /^run_/);
    assert.equal(body.flow, 'request-maintenance-visit');

    const audit = await call('/api/audit');
    const event = audit.body.events.find((item) => item.action === 'automate.trigger' && item.outcome === 'simulated');
    assert.ok(event, 'a simulated trigger is audited');
    assert.equal(event.resource, 'request-maintenance-visit');
    assert.equal(event.role, 'manager');
    assert.match(event.detail, /assetId,note/);
  });

  test('posts the envelope to the flow URL in live mode', async () => {
    goLive();
    const calls = [];
    setAutomateFetch(async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 202, headers: { get: () => null }, json: async () => ({ runId: '08584-flow-run' }) };
    });

    const { status, body } = await post('/api/automate/trigger', {
      flow: 'escalate-quality-issue',
      payload: { errorCode: 'E-7781', lineId: 'FA2' },
      confirm: true,
    });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, mode: 'live', runId: '08584-flow-run', flow: 'escalate-quality-issue', status: 202 });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, TRIGGER_URL);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers['content-type'], 'application/json');
    const envelope = JSON.parse(calls[0].options.body);
    assert.equal(envelope.flow, 'escalate-quality-issue');
    assert.deepEqual(envelope.payload, { errorCode: 'E-7781', lineId: 'FA2' });
    assert.deepEqual(envelope.requestedBy, { userId: 'demo-user', role: 'manager' });
    assert.match(envelope.requestedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(calls[0].options.signal, 'the request carries an abort signal for the timeout');

    const audit = await call('/api/audit');
    assert.ok(audit.body.events.some((item) => item.action === 'automate.trigger' && item.outcome === 'sent'));
  });

  test('a failing flow in live mode is reported and audited as failed', async () => {
    goLive();
    setAutomateFetch(async () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) }));
    const { status, body } = await post('/api/automate/trigger', { flow: 'daily-report-distribution', confirm: true });
    assert.equal(status, 502);
    assert.equal(body.ok, false);
    assert.equal(body.mode, 'live');
    assert.match(body.error, /500/);
    const audit = await call('/api/audit');
    assert.ok(audit.body.events.some((item) => item.action === 'automate.trigger' && item.outcome === 'failed'));
  });

  test('inbound is disabled without a secret, refused with a wrong one, answered with the right one', async () => {
    const disabled = await post('/api/automate/inbound', { question: 'what happened today' }, { role: null });
    assert.equal(disabled.status, 503);
    assert.equal(disabled.body.error, 'automate_inbound_disabled');

    saveSettings('power_automate', { values: { inboundSecret: 'flow-secret-42' } }, 'test');

    const wrong = await post('/api/automate/inbound', { question: 'what happened today' }, { role: null, headers: { 'x-jervis-automate-secret': 'nope' } });
    assert.equal(wrong.status, 401);
    const noHeader = await post('/api/automate/inbound', { question: 'what happened today' }, { role: null });
    assert.equal(noHeader.status, 401);
    const sessionOnly = await post('/api/automate/inbound', { question: 'what happened today' }, { role: 'manager' });
    assert.equal(sessionOnly.status, 401, 'a session never authenticates the inbound path');

    const ok = await post(
      '/api/automate/inbound',
      { question: 'what problems did we have today', language: 'en' },
      { role: null, headers: { 'x-jervis-automate-secret': 'flow-secret-42' } },
    );
    assert.equal(ok.status, 200);
    assert.ok(ok.body.sessionId);
    assert.ok(ok.body.answer, 'the chat result is returned');
    assert.equal(ok.body.access.role, 'engineer');
    assert.equal(ok.body.language, 'en');

    const empty = await post('/api/automate/inbound', { question: '' }, { role: null, headers: { 'x-jervis-automate-secret': 'flow-secret-42' } });
    assert.equal(empty.status, 400);

    const audit = await call('/api/audit');
    const event = audit.body.events.find((item) => item.action === 'automate.inbound' && item.outcome === 'ok');
    assert.ok(event, 'the inbound question is audited');
    assert.equal(event.userId, 'power-automate');
    assert.equal(event.role, 'engineer');
    assert.ok(audit.body.events.some((item) => item.action === 'automate.inbound' && item.outcome === 'refused'));
  });

  test('inbound is rate limited per caller', async () => {
    saveSettings('power_automate', { values: { inboundSecret: 'flow-secret-42' } }, 'test');
    configureInboundRateLimit({ max: 3, windowMs: 60_000 });
    const headers = { 'x-jervis-automate-secret': 'flow-secret-42' };
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await post('/api/automate/inbound', { question: '' }, { role: null, headers })).status, 400);
    }
    const limited = await post('/api/automate/inbound', { question: 'hello' }, { role: null, headers });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'rate_limited');
  });
});

describe('automate.trigger tool', () => {
  beforeEach(() => resetStore());

  test('is registered with the automate:run permission', () => {
    const tool = toolById('automate.trigger');
    assert.ok(tool);
    assert.equal(tool.permission, 'automate:run');
    assert.equal(tool.source, 'power_automate');
  });

  test('resolves a flow by name, label or fuzzy wording', () => {
    assert.equal(findFlow('escalate-quality-issue')?.name, 'escalate-quality-issue');
    assert.equal(findFlow('Escalate a quality issue')?.name, 'escalate-quality-issue');
    assert.equal(findFlow('escalate the quality problem')?.name, 'escalate-quality-issue');
    assert.equal(findFlow('maintenance visit')?.name, 'request-maintenance-visit');
    assert.equal(findFlow('send out the daily report')?.name, 'daily-report-distribution');
    assert.equal(findFlow('order pizza'), null);
    assert.equal(findFlow(''), null);
  });

  test('returns a proposal and never triggers anything', async () => {
    let fetched = 0;
    setAutomateFetch(async () => {
      fetched += 1;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    });
    const result = await automateTrigger.run({
      interpretation: { entities: { flow: 'escalate quality issue', flowPayload: { errorCode: 'E-7781' } } },
      access: { role: 'manager', permissions: [] },
    });
    assert.deepEqual(result.data.automation, {
      flow: 'escalate-quality-issue',
      label: 'Escalate a quality issue',
      payload: { errorCode: 'E-7781' },
      status: 'proposed',
      mode: 'mock',
    });
    assert.equal(result.data.available.length, 3);
    assert.equal(result.citation.source, 'power_automate');
    assert.equal(fetched, 0, 'the tool only proposes');

    const none = await automateTrigger.run({ flow: 'order pizza' });
    assert.equal(none.data.automation, null);
    assert.equal(none.data.query, 'order pizza');
    setAutomateFetch(null);
  });
});
