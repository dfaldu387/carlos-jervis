import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildWhere, PostgresRepository } from '../src/data/adapters/postgres.adapter.js';

describe('Postgres adapter — WHERE builder', () => {
  test('empty filter produces no WHERE clause and no params', () => {
    const { text, params } = buildWhere({});
    assert.equal(text, '');
    assert.deepEqual(params, []);
  });

  test('maps filter keys to columns with positional placeholders in order', () => {
    const { text, params } = buildWhere({ from: '2026-10-01', to: '2026-10-07', lineId: 'L1' });
    assert.equal(text, 'WHERE i.issue_date >= $1 AND i.issue_date <= $2 AND i.line_id = $3');
    assert.deepEqual(params, ['2026-10-01', '2026-10-07', 'L1']);
  });

  test('ignores undefined, null and empty-string values', () => {
    const { text, params } = buildWhere({ shiftId: 'S1', lineId: '', modelId: null, errorCode: undefined });
    assert.equal(text, 'WHERE i.shift_id = $1');
    assert.deepEqual(params, ['S1']);
  });

  test('never interpolates values into the SQL text (injection-safe)', () => {
    const { text, params } = buildWhere({ vin: "'; DROP TABLE production.issue_events; --" });
    assert.equal(text, 'WHERE i.vin = $1');
    assert.equal(params[0], "'; DROP TABLE production.issue_events; --");
  });

  test('maintenance column map excludes production-only dimensions', () => {
    const MAINTENANCE_COLUMNS = {
      from: ['ticket_date', '>='],
      to: ['ticket_date', '<='],
      shiftId: ['shift_id', '='],
      lineId: ['line_id', '='],
      status: ['status', '='],
    };
    // errorCode is not a maintenance column, so it must be dropped silently.
    const { text, params } = buildWhere({ lineId: 'L2', errorCode: 'E-4120' }, MAINTENANCE_COLUMNS);
    assert.equal(text, 'WHERE i.line_id = $1');
    assert.deepEqual(params, ['L2']);
  });
});

describe('Postgres adapter — connection guard', () => {
  test('throws a clear error when no connection string is configured', async () => {
    const repo = new PostgresRepository({ connectionString: '' });
    await assert.rejects(() => repo.listIssues({}), /DATABASE_URL is not set/);
  });
});
