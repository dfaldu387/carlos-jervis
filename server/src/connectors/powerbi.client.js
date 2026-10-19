import { logger } from '../utils/logger.js';

/**
 * Power BI REST client — live measures via the executeQueries endpoint.
 *
 * Kept separate from powerbi.connector.js so the live path can be unit-tested
 * (by injecting `fetchImpl`) and so the connector's mock computation stays
 * readable. Every value Jervis shows still names Power BI as its source; this
 * module is what makes that true in live mode.
 *
 * Auth: Entra ID client-credentials flow, the same app registration the probe
 * uses. Tokens are cached in memory until shortly before they expire.
 */

const TOKEN_ENDPOINT = (tenantId) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
const POWERBI_SCOPE = 'https://analysis.windows.net/powerbi/api/.default';
const EXECUTE_QUERIES = (groupId, datasetId) =>
  `https://api.powerbi.com/v1.0/myorg/groups/${encodeURIComponent(groupId)}/datasets/${encodeURIComponent(datasetId)}/executeQueries`;

const DEFAULT_TIMEOUT_MS = 15000;

// token cache keyed by tenant+client, so repeated questions reuse one token.
const tokenCache = new Map();

const fetchWithTimeout = async (url, options = {}, fetchImpl = fetch) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Power BI did not respond in time.');
    throw new Error(error.cause?.code ? `${error.message} (${error.cause.code})` : error.message);
  } finally {
    clearTimeout(timer);
  }
};

/** Acquire (or reuse) an Entra ID token for the Power BI API. */
export const getToken = async (values, { fetchImpl = fetch, now = Date.now } = {}) => {
  const cacheKey = `${values.tenantId}:${values.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > now() + 60_000) return cached.token;

  const response = await fetchWithTimeout(
    TOKEN_ENDPOINT(values.tenantId),
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: values.clientId,
        client_secret: values.clientSecret,
        scope: POWERBI_SCOPE,
      }),
    },
    fetchImpl,
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error_description?.split('\n')[0] ?? `Token request failed (${response.status}).`);
  }
  const token = body.access_token;
  const expiresAt = now() + (Number(body.expires_in ?? 3600) * 1000);
  tokenCache.set(cacheKey, { token, expiresAt });
  return token;
};

/** Reset cached tokens. Test hook; also safe to call after a secret rotation. */
export const clearTokenCache = () => tokenCache.clear();

// A DAX ROW() names its columns "[issues_total]"; strip brackets and the table
// prefix a measure column can carry ("Measures[issues_total]").
const normaliseKey = (raw) =>
  String(raw)
    .replace(/^.*\[/, '')
    .replace(/\]$/, '')
    .trim();

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Run the configured DAX measures query and return a map of measure key to
 * numeric value. The query must EVALUATE to a single row whose column names are
 * the measure keys (issues_total, first_pass_yield, ...).
 *
 * @returns {Promise<{ ok: boolean, values: Record<string, number|null>, detail?: string }>}
 */
export const executeMeasures = async (values, { fetchImpl = fetch } = {}) => {
  if (!values.datasetId || !values.measuresQuery) {
    return { ok: false, values: {}, detail: 'No datasetId / DAX query configured.' };
  }
  const token = await getToken(values, { fetchImpl });
  const response = await fetchWithTimeout(
    EXECUTE_QUERIES(values.workspaceId, values.datasetId),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        queries: [{ query: values.measuresQuery }],
        serializerSettings: { includeNulls: true },
      }),
    },
    fetchImpl,
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.error?.['pbi.error']?.details?.[0]?.detail?.value
      ?? body.error?.message
      ?? `executeQueries returned ${response.status}.`;
    throw new Error(detail);
  }

  const rows = body.results?.[0]?.tables?.[0]?.rows ?? [];
  if (rows.length === 0) {
    return { ok: false, values: {}, detail: 'DAX query returned no rows.' };
  }
  const out = {};
  for (const [key, value] of Object.entries(rows[0])) {
    out[normaliseKey(key)] = toNumber(value);
  }
  return { ok: true, values: out };
};

/**
 * Overlay live measure values onto the computed measure list. On any failure
 * the computed (mock/synthetic) values are kept unchanged — a live source is
 * never claimed for a number that did not actually come back from Power BI.
 */
export const overlayLiveMeasures = async (measures, values, deps = {}) => {
  try {
    const result = await executeMeasures(values, deps);
    if (!result.ok) {
      logger.info('Power BI live measures unavailable; using computed values', { detail: result.detail });
      return { measures, mode: 'mock' };
    }
    let applied = 0;
    const overlaid = measures.map((measure) => {
      const live = result.values[measure.key];
      if (live === undefined) return measure;
      applied += 1;
      return { ...measure, value: live, live: true };
    });
    logger.info('Power BI live measures applied', { applied });
    return { measures: overlaid, mode: applied > 0 ? 'live' : 'mock' };
  } catch (error) {
    logger.warn('Power BI executeQueries failed; using computed values', { error: error.message });
    return { measures, mode: 'mock' };
  }
};
