import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

let server;
let baseUrl;

const get = async (path, role = 'manager') => {
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'x-jervis-role': role } });
  return { status: response.status, body: await response.json() };
};

describe('command centre', () => {
  before(async () => {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  test('returns every panel in one snapshot', async () => {
    const { status, body } = await get('/api/command-center');
    assert.equal(status, 200);

    for (const key of [
      'status',
      'core',
      'feed',
      'agents',
      'timeline',
      'gauges',
      'providers',
      'today',
      'trend',
      'quickCommands',
    ]) {
      assert.ok(body[key], `${key} must be present`);
    }
  });

  test('the shift timeline covers all three production periods', async () => {
    const { body } = await get('/api/command-center');
    assert.equal(body.timeline.length, 3);
    assert.deepEqual(
      body.timeline.map((shift) => shift.window),
      ['06:00-14:00', '14:00-22:00', '22:00-06:00'],
    );
    assert.ok(body.timeline.every((shift) => ['running', 'complete', 'idle'].includes(shift.state)));
  });

  test('gauges stay inside 0-1 so the arcs cannot overrun', async () => {
    const { body } = await get('/api/command-center');
    assert.equal(body.gauges.length, 3);
    for (const gauge of body.gauges) {
      assert.ok(gauge.value >= 0 && gauge.value <= 1, `${gauge.key} out of range: ${gauge.value}`);
      assert.equal(typeof gauge.goodHigh, 'boolean', `${gauge.key} must say which direction is good`);
    }
  });

  test('every feed item carries a question the panel can ask', async () => {
    const { body } = await get('/api/command-center');
    for (const item of body.feed) {
      assert.ok(item.question?.length > 0, `${item.id} must be clickable into a question`);
      assert.ok(['critical', 'serious', 'warning', 'info'].includes(item.tone));
    }
  });

  test('feed questions actually answer', async () => {
    const { body } = await get('/api/command-center');
    const question = body.feed[0]?.question ?? body.quickCommands[0].question;

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jervis-role': 'manager' },
      body: JSON.stringify({ message: question }),
    });
    const answer = await response.json();

    assert.equal(response.status, 200);
    assert.ok(answer.answer.headline.length > 0);
  });

  test('does not repeat the same problem in the feed', async () => {
    const { body } = await get('/api/command-center');
    const ids = body.feed.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, 'feed rows must be distinct');

    const titles = body.feed.map((item) => item.title);
    assert.equal(new Set(titles).size, titles.length, 'the same problem must not be listed twice');
  });

  test('reports connected systems with an honest mode', async () => {
    const { body } = await get('/api/command-center');
    assert.ok(body.agents.length >= 4);
    assert.ok(body.agents.every((agent) => ['live', 'mock', 'planned'].includes(agent.state)));
  });

  test('cost figures stay out of the board for roles without finance access', async () => {
    const asViewer = await get('/api/command-center', 'viewer');
    assert.equal(asViewer.status, 200);
    const serialised = JSON.stringify(asViewer.body);
    assert.ok(!serialised.includes('rework_cost'), 'viewer board must not carry cost measures');
  });
});
