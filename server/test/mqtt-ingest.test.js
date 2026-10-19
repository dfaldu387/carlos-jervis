import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseStateMessage, DowntimeBuffer } from '../src/connectors/mqtt.ingest.js';

describe('MQTT ingestion — parseStateMessage', () => {
  test('parses a plain "stopped" payload on the state topic', () => {
    const r = parseStateMessage('plant1/L2/robot-3/state', 'stopped');
    assert.deepEqual(r, { lineId: 'L2', assetId: 'robot-3', state: 'stopped', reason: null });
  });

  test('parses a JSON payload with a reason and overrides', () => {
    const r = parseStateMessage('plant1/L2/robot-3/state', '{"state":"stopped","reason":"gripper fault","line":"L9"}');
    assert.equal(r.state, 'stopped');
    assert.equal(r.reason, 'gripper fault');
    assert.equal(r.lineId, 'L9');
  });

  test('normalises synonyms and rejects non-state topics / junk', () => {
    assert.equal(parseStateMessage('plant1/L1/a/state', 'run').state, 'running');
    assert.equal(parseStateMessage('plant1/L1/a/temperature', 'stopped'), null);
    assert.equal(parseStateMessage('plant1/L1/a/state', 'wat'), null);
  });
});

describe('MQTT ingestion — DowntimeBuffer', () => {
  test('a stop followed by a run becomes one downtime event with a duration', () => {
    let t = new Date('2026-10-15T09:00:00');
    const buffer = new DowntimeBuffer({ now: () => t });

    assert.equal(buffer.ingest('plant1/L2/robot-3/state', 'stopped'), null);
    t = new Date('2026-10-15T09:12:00'); // 12 minutes later
    const event = buffer.ingest('plant1/L2/robot-3/state', 'running');

    assert.ok(event);
    assert.equal(event.lineId, 'L2');
    assert.equal(event.durationMinutes, 12);
    assert.equal(event.shiftId, 'S1'); // 09:00 → early shift
    assert.equal(buffer.size, 1);
  });

  test('a repeated stop does not reset the clock; a lone run emits nothing', () => {
    let t = new Date('2026-10-15T15:00:00');
    const buffer = new DowntimeBuffer({ now: () => t });
    buffer.ingest('plant1/L1/a/state', 'stopped');
    t = new Date('2026-10-15T15:05:00');
    buffer.ingest('plant1/L1/a/state', 'stopped'); // ignored
    t = new Date('2026-10-15T15:20:00');
    const event = buffer.ingest('plant1/L1/a/state', 'running');
    assert.equal(event.durationMinutes, 20); // from the first stop, not the second
    assert.equal(event.shiftId, 'S2');

    assert.equal(buffer.ingest('plant1/L1/a/state', 'running'), null); // no open stop
  });

  test('list() filters by line and period and sorts by duration', () => {
    let t = new Date('2026-10-15T09:00:00');
    const buffer = new DowntimeBuffer({ now: () => t });
    const stopRun = (line, asset, minutes) => {
      buffer.ingest(`plant1/${line}/${asset}/state`, 'stopped');
      t = new Date(t.getTime() + minutes * 60000);
      buffer.ingest(`plant1/${line}/${asset}/state`, 'running');
      t = new Date(t.getTime() + 60000);
    };
    stopRun('L1', 'a', 5);
    stopRun('L2', 'b', 30);
    stopRun('L1', 'c', 10);

    const l1 = buffer.list({ lineId: 'L1' });
    assert.equal(l1.length, 2);
    assert.equal(l1[0].durationMinutes, 10); // sorted desc
    assert.equal(buffer.list({ limit: 1 })[0].durationMinutes, 30);
  });
});
