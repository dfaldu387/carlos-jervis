import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { INTEGRATIONS, integrationById, SECRET_KEYS } from './definitions.js';

/**
 * Integration settings store.
 *
 * Credentials are resolved from two layers: the environment (seeded from
 * .env, the deployment default) and a saved overrides file the Integrations
 * page writes to. Saved values win so the client can configure a connector at
 * runtime without editing env files, but a locked-down deployment can ignore
 * the file entirely and run on env alone.
 *
 * Secrets never leave the server. `publicView()` reports only whether a secret
 * is set and its last four characters; the full value is available solely to
 * server-side connector code through `resolve()`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const STORE_PATH =
  process.env.JERVIS_INTEGRATIONS_FILE ?? resolve(here, '../../data/integrations.json');

/** Shape on disk: { [id]: { enabled, values: { [key]: string }, updatedAt, updatedBy } }. */
let overrides = null;

const load = () => {
  if (overrides) return overrides;
  try {
    if (existsSync(STORE_PATH)) {
      overrides = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    } else {
      overrides = {};
    }
  } catch (error) {
    logger.warn('Could not read integration overrides; using env only', { error: error.message });
    overrides = {};
  }
  return overrides;
};

const persist = () => {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(overrides, null, 2));
  } catch (error) {
    logger.error('Could not persist integration overrides', { error: error.message });
    throw Object.assign(new Error('Settings could not be saved on the server.'), {
      statusCode: 500,
    });
  }
};

/** Value resolution order for one field: saved override, then env, then ''. */
const fieldValue = (integrationId, field) => {
  const saved = load()[integrationId]?.values ?? {};
  if (saved[field.key] !== undefined && saved[field.key] !== '') return String(saved[field.key]);
  const envValue = field.env ? process.env[field.env] : undefined;
  return envValue ? String(envValue) : '';
};

/** Full config for server-side connector use. Includes secrets. */
export const resolve_ = (integrationId) => {
  const definition = integrationById(integrationId);
  if (!definition) return null;
  const values = {};
  for (const field of definition.fields) {
    values[field.key] = fieldValue(integrationId, field);
  }
  return values;
};

/** All connectors' resolved config, keyed by id. For the connector registry. */
export const resolveAll = () =>
  Object.fromEntries(INTEGRATIONS.map((entry) => [entry.id, resolve_(entry.id)]));

/** True when every required field for a connector has a value. */
export const isConfigured = (integrationId) => {
  const definition = integrationById(integrationId);
  if (!definition) return false;
  const values = resolve_(integrationId);
  return definition.fields
    .filter((field) => field.required)
    .every((field) => Boolean(values[field.key]));
};

/** Whether the client has explicitly enabled live mode for this connector. */
export const isEnabled = (integrationId) => load()[integrationId]?.enabled === true;

/** A connector is "live" only when configured AND enabled. */
export const isLive = (integrationId) => isConfigured(integrationId) && isEnabled(integrationId);

const maskSecret = (value) => {
  if (!value) return { set: false };
  const tail = value.length > 4 ? value.slice(-4) : value;
  return { set: true, hint: `····${tail}` };
};

/** Browser-safe view: field metadata, plain values, masked secrets, status. */
export const publicView = () =>
  INTEGRATIONS.map((definition) => {
    const resolved = resolve_(definition.id);
    const record = load()[definition.id] ?? {};
    const secretKeys = SECRET_KEYS[definition.id];

    return {
      id: definition.id,
      name: definition.name,
      summary: definition.summary,
      docsUrl: definition.docsUrl,
      probe: definition.probe,
      liveBehaviour: definition.liveBehaviour,
      enabled: record.enabled === true,
      configured: isConfigured(definition.id),
      live: isLive(definition.id),
      updatedAt: record.updatedAt ?? null,
      lastCheck: record.lastCheck ?? null,
      fields: definition.fields.map((field) => {
        const value = resolved[field.key] ?? '';
        const base = {
          key: field.key,
          label: field.label,
          help: field.help ?? null,
          placeholder: field.placeholder ?? null,
          required: Boolean(field.required),
          secret: Boolean(field.secret),
          multiline: Boolean(field.multiline),
          fromEnv: Boolean(field.env && process.env[field.env] && record.values?.[field.key] === undefined),
        };
        if (secretKeys.includes(field.key)) {
          return { ...base, ...maskSecret(value) };
        }
        return { ...base, value };
      }),
    };
  });

/**
 * Save client-supplied settings for one connector.
 *
 * Secret fields are skipped when empty so the UI can submit the form without
 * echoing the secret back and without wiping it. A non-empty secret replaces
 * the stored one.
 */
export const saveSettings = (integrationId, { values = {}, enabled }, actor = 'demo-user') => {
  const definition = integrationById(integrationId);
  if (!definition) {
    throw Object.assign(new Error(`Unknown integration "${integrationId}".`), { statusCode: 404 });
  }

  const store = load();
  const record = store[integrationId] ?? { values: {} };
  const allowed = new Set(definition.fields.map((field) => field.key));
  const secretKeys = new Set(SECRET_KEYS[integrationId]);

  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key)) continue;
    if (secretKeys.has(key) && (value === '' || value === null || value === undefined)) continue;
    record.values[key] = value === null || value === undefined ? '' : String(value).trim();
  }

  if (typeof enabled === 'boolean') record.enabled = enabled;
  record.updatedAt = new Date().toISOString();
  record.updatedBy = actor;

  store[integrationId] = record;
  persist();

  return publicView().find((entry) => entry.id === integrationId);
};

/** Record the outcome of a Test connection run, for the "last checked" line. */
export const recordCheck = (integrationId, result) => {
  const store = load();
  const record = store[integrationId] ?? { values: {} };
  record.lastCheck = {
    at: new Date().toISOString(),
    ok: Boolean(result.ok),
    detail: result.detail ?? null,
    latencyMs: result.latencyMs ?? null,
  };
  store[integrationId] = record;
  persist();
  return record.lastCheck;
};

/** Test hook: drop in-memory and on-disk state so suites start clean. */
export const resetStore = () => {
  overrides = {};
  try {
    if (existsSync(STORE_PATH)) writeFileSync(STORE_PATH, '{}');
  } catch {
    /* ignore */
  }
};

export { config as _config };
