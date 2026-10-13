import { randomUUID } from 'node:crypto';
import { isLive, resolve_ } from '../integrations/store.js';
import { recordAudit } from '../security/audit.js';
import { logger } from '../utils/logger.js';

/**
 * Power Automate seam (outbound).
 *
 * Jervis never starts a flow on its own: the agent can only *propose* one
 * (tools/automate.js), and a flow runs only after POST /api/automate/trigger
 * arrives with `confirm: true`. In mock mode the trigger is simulated and
 * recorded in the audit trail; in live mode the approved flow's HTTP trigger
 * receives a JSON envelope and the run id it returns is handed back.
 *
 * The catalog of flows Jervis may start comes from the `flowCatalog` setting
 * (JSON list); without one the three sample flows below are offered so the
 * end-to-end path can be exercised before the client approves real flows.
 */

const TIMEOUT_MS = 10_000;

export const SAMPLE_FLOWS = [
  {
    name: 'escalate-quality-issue',
    label: 'Escalate a quality issue',
    description: 'Opens an escalation with the quality lead and the supplier contact for an error code or vehicle.',
  },
  {
    name: 'request-maintenance-visit',
    label: 'Request a maintenance visit',
    description: 'Raises a maintenance request for an asset or station with the Integral Portal team.',
  },
  {
    name: 'daily-report-distribution',
    label: 'Distribute the daily report',
    description: 'Sends the daily production report to the plant distribution list.',
  },
];

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Test hook: swap the HTTP client (null restores global fetch). */
export const setAutomateFetch = (fn) => {
  fetchImpl = fn ? (...args) => fn(...args) : (...args) => globalThis.fetch(...args);
};

const settings = () => resolve_('power_automate') ?? {};

export const automateMode = () => (isLive('power_automate') ? 'live' : 'mock');

/**
 * Permission check for starting a flow.
 *
 * TODO(roles): add 'automate:run' to the manager and engineer roles in
 * security/roles.js once the SSO work on that file lands, then drop the
 * manager-only fallback below. Until then a role that does not carry the
 * permission string is allowed only when it is the manager.
 */
export const canRunAutomation = (access) =>
  Boolean(access) && (access.role === 'manager' || (access.permissions ?? []).includes('automate:run'));

const slug = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Parses the catalog setting; anything malformed falls back to the samples with a warning. */
const parseCatalog = (text) => {
  if (!text || !String(text).trim()) return null;
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('catalog is not a list');
    const flows = parsed
      .filter((entry) => entry && typeof entry === 'object' && entry.name)
      .map((entry) => ({
        name: slug(entry.name),
        label: String(entry.label ?? entry.name),
        description: entry.description ? String(entry.description) : '',
        url: entry.url ? String(entry.url) : null,
      }));
    return flows.length > 0 ? flows : null;
  } catch (error) {
    logger.warn('Power Automate flow catalog is not valid JSON; using the sample flows', { error: error.message });
    return null;
  }
};

/** The flows Jervis may start, with their mode. URLs stay server-side. */
export const listFlows = () => {
  const mode = automateMode();
  const catalog = parseCatalog(settings().flowCatalog) ?? SAMPLE_FLOWS.map((flow) => ({ ...flow, url: null }));
  return catalog.map((flow) => ({
    name: flow.name,
    label: flow.label,
    description: flow.description ?? '',
    mode,
    url: flow.url ?? null,
  }));
};

/** Browser-safe listing: no URLs. */
export const publicFlows = () => listFlows().map(({ name, label, description, mode }) => ({ name, label, description, mode }));

const tokens = (value) =>
  String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/)
    .filter((token) => token.length > 1);

/**
 * Finds a flow by exact name, exact label, or a fuzzy match on the words of
 * the request ("escalate the quality issue" -> escalate-quality-issue). The
 * flow whose name and label share the most words with the query wins; ties
 * and a zero score mean no match.
 */
export const findFlow = (query) => {
  const flows = listFlows();
  const needle = String(query ?? '').trim();
  if (!needle) return null;
  const wanted = slug(needle);
  const exact = flows.find((flow) => flow.name === wanted || flow.label.toLowerCase() === needle.toLowerCase());
  if (exact) return exact;

  const words = tokens(needle);
  if (words.length === 0) return null;
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const flow of flows) {
    const haystack = new Set(tokens(`${flow.name} ${flow.label}`));
    const score = words.filter((word) => [...haystack].some((entry) => entry.startsWith(word) || word.startsWith(entry))).length;
    if (score > bestScore) {
      best = flow;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0) {
      tie = true;
    }
  }
  return bestScore > 0 && !tie ? best : null;
};

const newRunId = () => `run_${randomUUID().slice(0, 12)}`;

/**
 * Starts a flow. The caller has already enforced the permission and the
 * explicit confirmation; this records the outcome and talks to the flow.
 *
 * @returns {Promise<{ ok: boolean, mode: 'simulated'|'live', runId: string, flow: string, status?: number, error?: string }>}
 */
export const triggerFlow = async ({ name, payload = {}, access }) => {
  const flow = listFlows().find((entry) => entry.name === slug(name));
  if (!flow) {
    throw Object.assign(new Error(`Unknown flow "${name}".`), { statusCode: 404, code: 'unknown_flow' });
  }
  const requestedAt = new Date().toISOString();

  if (flow.mode !== 'live') {
    const runId = newRunId();
    recordAudit({
      access,
      action: 'automate.trigger',
      resource: flow.name,
      outcome: 'simulated',
      detail: `run ${runId}; payload keys: ${Object.keys(payload ?? {}).join(',') || '-'}`,
    });
    return { ok: true, mode: 'simulated', runId, flow: flow.name };
  }

  const url = flow.url || settings().triggerUrl;
  const envelope = {
    flow: flow.name,
    payload: payload ?? {},
    requestedBy: { userId: access?.userId ?? 'unknown', role: access?.role ?? 'unknown' },
    requestedAt,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    const runId = String(body?.runId ?? body?.run_id ?? body?.id ?? response.headers?.get?.('x-ms-workflow-run-id') ?? newRunId());
    if (!response.ok) {
      recordAudit({ access, action: 'automate.trigger', resource: flow.name, outcome: 'failed', detail: `HTTP ${response.status}` });
      return { ok: false, mode: 'live', runId, flow: flow.name, status: response.status, error: `Flow trigger returned ${response.status}.` };
    }
    recordAudit({ access, action: 'automate.trigger', resource: flow.name, outcome: 'sent', detail: `run ${runId} (HTTP ${response.status})` });
    return { ok: true, mode: 'live', runId, flow: flow.name, status: response.status };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? `no response within ${TIMEOUT_MS / 1000}s` : error?.message ?? 'network error';
    recordAudit({ access, action: 'automate.trigger', resource: flow.name, outcome: 'failed', detail: reason });
    return { ok: false, mode: 'live', runId: newRunId(), flow: flow.name, error: `Flow trigger failed: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
};

/** The inbound shared secret, if any (server-side only). */
export const inboundSecret = () => String(settings().inboundSecret ?? '');
