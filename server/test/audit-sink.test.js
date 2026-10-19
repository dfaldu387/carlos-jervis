import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { PostgresAuditSink } from '../src/security/audit-sink.js';
import {
  recordQuery,
  recordAudit,
  listAudit,
  listEvents,
  setAuditSink,
  hydrateAudit,
} from '../src/security/audit.js';

// A fake pg pool that records queries and returns a scripted result.
const makePool = (rowsFor = () => ({ rows: [] })) => {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      return rowsFor(text, params);
    },
  };
};

const access = { userId: 'u1', role: 'manager' };
const sampleResult = {
  interpretation: { intent: 'ISSUES_BY_CODE', period: { from: '2026-10-01', to: '2026-10-07' } },
  sources: [{ label: 'Power BI', object: 'measures' }],
  trace: [{ name: 'retrieve', tool: 'powerbi.measures' }],
  answer: { redactions: [], provider: 'deterministic' },
  elapsedMs: 12,
};

describe('PostgresAuditSink — write mapping', () => {
  test('writeQuery inserts into audit.query_log with mapped params', async () => {
    const pool = makePool();
    const sink = new PostgresAuditSink({ pool });
    await sink.writeQuery({
      id: 'audit-1',
      at: '2026-10-19T09:00:00.000Z',
      userId: 'u1',
      role: 'manager',
      question: 'FPY?',
      intent: 'MEASURE',
      sources: ['Power BI:measures'],
      toolsUsed: ['powerbi.measures'],
      redactions: [],
      provider: 'deterministic',
      elapsedMs: 12,
    });
    assert.equal(pool.calls.length, 1);
    assert.match(pool.calls[0].text, /INSERT INTO audit\.query_log/);
    assert.equal(pool.calls[0].params[0], 'audit-1');
    assert.equal(pool.calls[0].params[4], 'FPY?');
    assert.equal(pool.calls[0].params[8], '[]'); // redactions serialised to jsonb text
  });

  test('writeEvent inserts into audit.events', async () => {
    const pool = makePool();
    const sink = new PostgresAuditSink({ pool });
    await sink.writeEvent({
      id: 'evt-1',
      at: '2026-10-19T09:00:00.000Z',
      userId: 'u1',
      role: 'manager',
      action: 'integration.save',
      resource: 'powerbi',
      outcome: 'ok',
      detail: null,
    });
    assert.match(pool.calls[0].text, /INSERT INTO audit\.events/);
    assert.equal(pool.calls[0].params[4], 'integration.save');
  });

  test('rowToEntry restores the in-memory shape', () => {
    const entry = PostgresAuditSink.rowToEntry({
      entry_id: 'a1',
      logged_at: new Date('2026-10-19T09:00:00.000Z'),
      user_id: 'u1',
      role: 'manager',
      question: 'q',
      intent: 'I',
      period_from: '2026-10-01',
      period_to: '2026-10-07',
      sources: ['Power BI:measures'],
      tools_used: ['t'],
      redactions: [],
      provider: 'deterministic',
      elapsed_ms: 5,
    });
    assert.equal(entry.id, 'a1');
    assert.equal(entry.at, '2026-10-19T09:00:00.000Z');
    assert.deepEqual(entry.period, { from: '2026-10-01', to: '2026-10-07' });
  });
});

describe('audit.js — write-through and hydration', () => {
  afterEach(() => setAuditSink(null));

  test('recordQuery and recordAudit mirror to the attached sink', async () => {
    const pool = makePool();
    const sink = new PostgresAuditSink({ pool });
    setAuditSink(sink);

    recordQuery({ question: 'FPY?', access, result: sampleResult });
    recordAudit({ access, action: 'test.action', resource: 'thing' });

    // Write-through is fire-and-forget; let the microtasks flush.
    await new Promise((r) => setImmediate(r));

    assert.equal(pool.calls.some((c) => /query_log/.test(c.text)), true);
    assert.equal(pool.calls.some((c) => /audit\.events/.test(c.text)), true);
    // In-memory view still works unchanged.
    assert.ok(listAudit({ limit: 10 }).some((e) => e.question === 'FPY?'));
    assert.ok(listEvents({ limit: 10 }).some((e) => e.action === 'test.action'));
  });

  test('hydrateAudit loads persisted records into the in-memory view', async () => {
    const pool = makePool((text) => {
      if (/query_log/.test(text)) {
        return {
          rows: [
            {
              entry_id: 'hydrated-1',
              logged_at: new Date('2026-10-18T10:00:00.000Z'),
              user_id: 'u1',
              role: 'manager',
              question: 'persisted question',
              intent: 'I',
              sources: [],
              tools_used: [],
              redactions: [],
              provider: 'deterministic',
              elapsed_ms: 1,
            },
          ],
        };
      }
      return { rows: [] };
    });
    setAuditSink(new PostgresAuditSink({ pool }));
    await hydrateAudit();
    assert.ok(listAudit({ limit: 50 }).some((e) => e.id === 'hydrated-1'));
  });
});
