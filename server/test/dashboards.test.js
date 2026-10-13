import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.JERVIS_DASHBOARDS_FILE = join(tmpdir(), `jervis-dash-${randomUUID()}.json`);
process.env.JERVIS_TASKS_FILE = join(tmpdir(), `jervis-tasks-${randomUUID()}.json`);
process.env.JERVIS_INTEGRATIONS_FILE = join(tmpdir(), `jervis-int-${randomUUID()}.json`);

const { createApp } = await import('../src/app.js');
const { answerQuestion } = await import('../src/agent/orchestrator.js');
const { resolveAccess } = await import('../src/security/roles.js');
const { matchMeasure } = await import('../src/agent/tools/dashboards.js');
const { resetDashboards } = await import('../src/dashboards/store.js');

let server;
let baseUrl;

const call = async (path, { role = 'manager', ...options } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-jervis-role': role, ...(options.headers ?? {}) },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

const manager = resolveAccess('manager');

describe('Dashboards API', () => {
  before(async () => {
    resetDashboards();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  test('creating and deleting need dashboards:write', async () => {
    const denied = await call('/api/dashboards', { role: 'viewer', method: 'POST', body: JSON.stringify({ question: 'issues this week' }) });
    assert.equal(denied.status, 403);
    assert.equal((await call('/api/dashboards', { role: 'viewer' })).status, 200, 'listing is open to signed-in roles');
  });

  test('builds a dashboard from a question and recomputes it on read', async () => {
    const created = await call('/api/dashboards', {
      method: 'POST',
      body: JSON.stringify({ question: 'create a dashboard for paint line issues this week' }),
    });
    assert.equal(created.status, 201);
    const item = created.body.item;
    assert.ok(item.id && item.createdAt && item.createdBy);
    assert.equal(item.title, 'Paint line issues this week');
    assert.equal(item.question, 'create a dashboard for paint line issues this week');
    assert.ok(item.period.from <= item.period.to && item.period.label);
    assert.equal(item.filter.lineId, 'PL2', 'the line from the question filters every widget');
    assert.ok(item.widgets.length >= 3 && item.widgets.length <= 6);

    for (const widget of item.widgets) {
      assert.ok(['kpi', 'bar', 'line', 'pie'].includes(widget.type));
      assert.ok(widget.id && widget.title && widget.source.label && widget.source.object);
      if (widget.type === 'kpi') {
        assert.equal(typeof widget.data.value, 'number');
        assert.ok('unit' in widget.data);
      } else if (widget.type === 'line') {
        assert.ok(Array.isArray(widget.data));
        for (const point of widget.data) assert.ok(point.date && typeof point.value === 'number');
      } else {
        assert.ok(Array.isArray(widget.data));
        for (const point of widget.data) assert.ok(point.name && typeof point.value === 'number');
      }
    }
    assert.ok(item.widgets.some((widget) => widget.type === 'line'), 'a multi-day period gets a trend');

    const list = await call('/api/dashboards');
    assert.equal(list.body.items.length, 1);
    assert.deepEqual(Object.keys(list.body.items[0]).sort(), ['createdAt', 'createdBy', 'id', 'question', 'title', 'widgetCount'].sort());

    const read = await call(`/api/dashboards/${item.id}`);
    assert.equal(read.status, 200);
    assert.ok(read.body.item.refreshedAt >= item.refreshedAt);
    assert.equal(read.body.item.widgets.length, item.widgets.length);
    assert.ok(read.body.item.widgets.every((widget) => widget.data !== null));

    assert.equal((await call(`/api/dashboards/${item.id}`, { method: 'DELETE' })).body.ok, true);
    assert.equal((await call(`/api/dashboards/${item.id}`)).status, 404);
    assert.equal((await call('/api/dashboards', { method: 'POST', body: JSON.stringify({}) })).status, 400);
  });

  test('the chat intent creates a dashboard and attaches it', async () => {
    const { status, body } = await call('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'create a dashboard for error codes on Final Assembly 2 this week' }),
    });
    assert.equal(status, 200);
    assert.equal(body.interpretation.intent, 'create_dashboard');
    assert.ok(body.dashboard?.id);
    assert.equal(body.dashboard.filter.lineId, 'FA2');
    assert.ok(body.dashboard.widgets.some((widget) => widget.type === 'pie'), 'an error-code question gets a pie');
    assert.match(body.answer.headline, /Dashboard created/);
    assert.ok((await call('/api/dashboards')).body.items.some((entry) => entry.id === body.dashboard.id));
  });
});

describe('Power BI measure lookup', () => {
  test('finds a measure by its common names', async () => {
    const oee = await answerQuestion({ question: 'what is the OEE in Power BI', access: manager });
    assert.equal(oee.interpretation.intent, 'powerbi_measure');
    assert.match(oee.measure.name, /OEE/);
    assert.equal(typeof oee.measure.value, 'number');
    assert.equal(oee.measure.unit, '%');
    assert.equal(oee.measure.report, 'Production Quality Overview');
    assert.match(oee.measure.url, /^https:\/\/app\.powerbi\.com\//);
    assert.match(oee.answer.headline, /OEE/);

    const fpy = await answerQuestion({ question: 'show me the first pass yield measure', access: manager });
    assert.match(fpy.measure.name, /first pass yield/i);

    const german = await answerQuestion({ question: 'Wie hoch ist die Nacharbeitsquote laut Power BI?', access: manager });
    assert.equal(german.language, 'de');
    assert.match(german.measure.name, /rework rate/i);
    assert.match(german.answer.narrative[0], /Power-BI-Bericht/);
  });

  test('cost measures stay hidden from roles without finance:read', async () => {
    const viewer = await answerQuestion({ question: 'what is the rework cost measure in Power BI', access: resolveAccess('viewer') });
    assert.notEqual(viewer.measure?.key, 'rework_cost');
    const manager2 = await answerQuestion({ question: 'what is the rework cost measure in Power BI', access: manager });
    assert.equal(manager2.measure.key, 'rework_cost');
  });

  test('an unknown measure lists what is available', async () => {
    const result = await answerQuestion({ question: 'what is the moon phase in Power BI', access: manager });
    assert.equal(result.measure.name, null);
    assert.ok(result.measure.available.length >= 5);
    assert.match(result.answer.headline, /No Power BI measure matches/);
  });

  test('fuzzy matching prefers the closest name', () => {
    const measures = [
      { key: 'first_pass_yield', label: 'First pass yield (est.)' },
      { key: 'issues_total', label: 'Issues recorded' },
      { key: 'oee', label: 'OEE (est.)' },
    ];
    assert.equal(matchMeasure('fpy', measures).measure.key, 'first_pass_yield');
    assert.equal(matchMeasure('overall equipment effectiveness', measures).measure.key, 'oee');
    assert.equal(matchMeasure('number of issues', measures).measure.key, 'issues_total');
    assert.equal(matchMeasure('xyzzy', measures), null);
  });
});
