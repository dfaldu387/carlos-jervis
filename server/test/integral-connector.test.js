import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mapTicket, fetchTickets } from '../src/connectors/integral.connector.js';

const VALUES = { baseUrl: 'https://integral.internal/', apiKey: 'key-1', ticketsPath: '/api/tickets' };

const jsonResponse = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

describe('Integral Portal — mapTicket', () => {
  test('maps snake_case portal fields to the agent ticket shape', () => {
    const t = mapTicket({
      ticket_id: 'T-9',
      ticket_date: '2026-10-15T08:00:00Z',
      shift_id: 'S1',
      asset_id: 'A-3',
      asset_name: 'Robot 3',
      line_id: 'L2',
      opened_at: '2026-10-15T08:00:00Z',
      closed_at: null,
      state: 'in_progress',
      severity: 'High',
      summary: 'Gripper fault',
      assigned_to: 'M. Weber',
    });
    assert.equal(t.id, 'T-9');
    assert.equal(t.date, '2026-10-15');
    assert.equal(t.lineId, 'L2');
    assert.equal(t.status, 'open'); // in_progress → open
    assert.equal(t.priority, 'high');
    assert.equal(t.description, 'Gripper fault');
    assert.equal(t.technician, 'M. Weber');
  });

  test('maps camelCase variants and normalises closed status', () => {
    const t = mapTicket({ id: 'T-1', ticketDate: '2026-10-10', status: 'Resolved', priority: 'low' });
    assert.equal(t.status, 'closed');
    assert.equal(t.priority, 'low');
  });
});

describe('Integral Portal — fetchTickets', () => {
  test('sends auth headers, passes the period, and extracts rows under common envelopes', async () => {
    let captured;
    const fetchImpl = async (url, options) => {
      captured = { url, options };
      return jsonResponse({ tickets: [{ id: 'T-1', status: 'open' }, { id: 'T-2', status: 'closed' }] });
    };
    const rows = await fetchTickets({ from: '2026-10-01', to: '2026-10-07', lineId: 'L1' }, { fetchImpl, values: VALUES });
    assert.equal(rows.length, 2);
    assert.match(captured.url, /\/api\/tickets\?/);
    assert.match(captured.url, /from=2026-10-01/);
    assert.match(captured.url, /line=L1/);
    assert.equal(captured.options.headers['x-api-key'], 'key-1');
    assert.equal(captured.options.headers.authorization, 'Bearer key-1');
  });

  test('honours a limit and handles a bare array body', async () => {
    const fetchImpl = async () => jsonResponse([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
    const rows = await fetchTickets({ limit: 2 }, { fetchImpl, values: VALUES });
    assert.equal(rows.length, 2);
  });

  test('throws on a non-OK response so the caller can fall back', async () => {
    const fetchImpl = async () => jsonResponse({}, false, 503);
    await assert.rejects(() => fetchTickets({}, { fetchImpl, values: VALUES }), /returned 503/);
  });
});
