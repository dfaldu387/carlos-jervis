import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getToken,
  executeMeasures,
  overlayLiveMeasures,
  clearTokenCache,
} from '../src/connectors/powerbi.client.js';

const VALUES = {
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'secret',
  workspaceId: 'ws-1',
  datasetId: 'ds-1',
  measuresQuery: 'EVALUATE ROW("issues_total", [Issues])',
};

const jsonResponse = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

// A fake fetch that answers the token endpoint then the executeQueries endpoint.
const makeFetch = (queryResponse) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/oauth2/v2.0/token')) {
      return jsonResponse({ access_token: 'tok-123', expires_in: 3600 });
    }
    if (url.includes('/executeQueries')) {
      return queryResponse;
    }
    throw new Error(`unexpected url ${url}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
};

describe('Power BI client — token', () => {
  beforeEach(() => clearTokenCache());

  test('acquires a token and caches it across calls', async () => {
    const fetchImpl = makeFetch(jsonResponse({}));
    const t1 = await getToken(VALUES, { fetchImpl });
    const t2 = await getToken(VALUES, { fetchImpl });
    assert.equal(t1, 'tok-123');
    assert.equal(t2, 'tok-123');
    // Only one token request despite two getToken calls.
    assert.equal(fetchImpl.calls.filter((c) => c.url.includes('/token')).length, 1);
  });

  test('re-requests a token once it is near expiry', async () => {
    const fetchImpl = makeFetch(jsonResponse({}));
    let clock = 0;
    const now = () => clock;
    await getToken(VALUES, { fetchImpl, now });
    clock = 3600 * 1000; // past the 60s skew window
    await getToken(VALUES, { fetchImpl, now });
    assert.equal(fetchImpl.calls.filter((c) => c.url.includes('/token')).length, 2);
  });
});

describe('Power BI client — executeMeasures', () => {
  beforeEach(() => clearTokenCache());

  test('parses a single-row result and normalises bracketed column names', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({
        results: [{ tables: [{ rows: [{ '[issues_total]': 42, 'Measures[first_pass_yield]': 0.93 }] }] }],
      }),
    );
    const result = await executeMeasures(VALUES, { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.values.issues_total, 42);
    assert.equal(result.values.first_pass_yield, 0.93);
  });

  test('returns ok:false when no dataset or query is configured', async () => {
    const fetchImpl = makeFetch(jsonResponse({}));
    const result = await executeMeasures({ ...VALUES, datasetId: '' }, { fetchImpl });
    assert.equal(result.ok, false);
  });

  test('throws a readable error on an API error body', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({ error: { message: 'Dataset not found' } }, false, 404),
    );
    await assert.rejects(() => executeMeasures(VALUES, { fetchImpl }), /Dataset not found/);
  });
});

describe('Power BI client — overlayLiveMeasures', () => {
  beforeEach(() => clearTokenCache());

  const computed = [
    { key: 'issues_total', label: 'Issues recorded', value: 10 },
    { key: 'first_pass_yield', label: 'First pass yield (est.)', value: 0.5 },
    { key: 'oee', label: 'OEE (est.)', value: 0.4 },
  ];

  test('overlays live values and flags them, leaving unmatched measures computed', async () => {
    const fetchImpl = makeFetch(
      jsonResponse({ results: [{ tables: [{ rows: [{ '[issues_total]': 42 }] }] }] }),
    );
    const { measures, mode } = await overlayLiveMeasures(computed, VALUES, { fetchImpl });
    assert.equal(mode, 'live');
    const issues = measures.find((m) => m.key === 'issues_total');
    assert.equal(issues.value, 42);
    assert.equal(issues.live, true);
    // Not returned by DAX → untouched, not flagged live.
    const oee = measures.find((m) => m.key === 'oee');
    assert.equal(oee.value, 0.4);
    assert.equal(oee.live, undefined);
  });

  test('falls back to computed values (mode mock) when the live call fails', async () => {
    const fetchImpl = makeFetch(jsonResponse({ error: { message: 'boom' } }, false, 500));
    const { measures, mode } = await overlayLiveMeasures(computed, VALUES, { fetchImpl });
    assert.equal(mode, 'mock');
    assert.deepEqual(measures, computed);
  });
});
