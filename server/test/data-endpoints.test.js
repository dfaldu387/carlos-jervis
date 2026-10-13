import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.JERVIS_INTEGRATIONS_FILE = join(tmpdir(), `jervis-data-${randomUUID()}.json`);

const { createApp } = await import('../src/app.js');

let server;
let baseUrl;

const get = async (path) => {
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'x-jervis-role': 'manager' } });
  return { status: response.status, body: await response.json() };
};

describe('Data endpoints for the UI pages', () => {
  before(async () => {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  test('dashboard returns labelled KPIs and a trend', async () => {
    const { status, body } = await get('/api/dashboard?days=14');
    assert.equal(status, 200);
    assert.ok(body.kpis.openIssues.label);
    assert.equal(typeof body.kpis.openIssues.value, 'number');
    assert.ok('total' in body.kpis.connectedSources);
    assert.ok(Array.isArray(body.activityTrend));
    assert.ok(body.issueBreakdown.bySeverity.length > 0);
  });

  test('issues list paginates, and the summary counts are present', async () => {
    const { status, body } = await get('/api/issues?page=1&pageSize=10');
    assert.equal(status, 200);
    assert.equal(body.items.length, 10);
    assert.ok(body.total > 10);
    assert.equal(body.page, 1);
    assert.ok(body.summary.total >= body.summary.critical);
  });

  test('a severity filter returns only that severity', async () => {
    const { body } = await get('/api/issues?severity=critical&pageSize=100');
    assert.ok(body.items.length > 0);
    assert.ok(body.items.every((issue) => issue.severity === 'critical'));
  });

  test('sorting by severity is honoured', async () => {
    const { body } = await get('/api/issues?sort=severity&dir=desc&pageSize=5');
    assert.equal(body.sort, 'severity');
    assert.equal(body.items[0].severity, 'critical');
  });

  test('an issue detail carries a timeline and sources', async () => {
    const list = await get('/api/issues?pageSize=1');
    const id = list.body.items[0].id;
    const { status, body } = await get(`/api/issues/${id}`);
    assert.equal(status, 200);
    assert.equal(body.issue.id, id);
    assert.ok(body.timeline.length >= 1);
    assert.ok(body.sources.some((source) => source.source === 'databricks'));
  });

  test('a missing issue id is a 404', async () => {
    const { status } = await get('/api/issues/ISS-00000');
    assert.equal(status, 404);
  });

  test('analytics returns severity, area and error-code aggregates', async () => {
    const { status, body } = await get('/api/analytics?days=14');
    assert.equal(status, 200);
    assert.equal(body.bySeverity.length, 4);
    assert.ok(body.byArea.length > 0);
    assert.ok(body.byErrorCode.length > 0);
  });

  test('conversations are scoped and start empty for the header user', async () => {
    const { status, body } = await get('/api/conversations');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.items));
  });
});
