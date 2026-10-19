import { resolve_ } from '../integrations/store.js';
import { logger } from '../utils/logger.js';

/**
 * Integral Portal connector — live maintenance tickets.
 *
 * Reads tickets from the portal's REST API for the period a question covers and
 * maps them to the maintenance-ticket shape the agent uses. The portal's exact
 * field names are not yet confirmed with the client, so the mapping accepts the
 * common variants (snake_case / camelCase) and falls back gracefully; confirm
 * the real schema with Carlos and tighten `mapTicket` once a sample is in hand.
 *
 * The maintenance tool calls this only when the connector is live; on any
 * failure the caller keeps the synthetic tickets, so a question is never left
 * unanswered because the portal is down.
 */

const DEFAULT_TICKETS_PATH = '/api/tickets';
const TIMEOUT_MS = 10000;

const fetchWithTimeout = async (url, options = {}, fetchImpl = fetch) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Integral Portal did not respond in time.');
    throw new Error(error.cause?.code ? `${error.message} (${error.cause.code})` : error.message);
  } finally {
    clearTimeout(timer);
  }
};

const pick = (row, ...keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
};

const asDateKey = (value) => {
  if (!value) return null;
  const s = String(value);
  // Already a YYYY-MM-DD, or an ISO timestamp we can slice.
  return s.length >= 10 ? s.slice(0, 10) : s;
};

const normaliseStatus = (value) => {
  const s = String(value ?? '').toLowerCase();
  if (['open', 'in_progress', 'in progress', 'active', 'new'].includes(s)) return 'open';
  if (['closed', 'resolved', 'done', 'completed'].includes(s)) return 'closed';
  return s || 'open';
};

/** Map one portal ticket (unknown-ish schema) to the agent's ticket shape. */
export const mapTicket = (row) => ({
  id: String(pick(row, 'id', 'ticketId', 'ticket_id', 'number') ?? ''),
  date: asDateKey(pick(row, 'date', 'ticketDate', 'ticket_date', 'openedAt', 'opened_at', 'createdAt')),
  shiftId: pick(row, 'shiftId', 'shift_id', 'shift') ?? null,
  assetId: pick(row, 'assetId', 'asset_id', 'asset') ?? null,
  assetName: pick(row, 'assetName', 'asset_name', 'assetLabel') ?? null,
  lineId: pick(row, 'lineId', 'line_id', 'line') ?? null,
  openedAt: pick(row, 'openedAt', 'opened_at', 'createdAt', 'created_at') ?? null,
  closedAt: pick(row, 'closedAt', 'closed_at', 'resolvedAt', 'resolved_at') ?? null,
  status: normaliseStatus(pick(row, 'status', 'state')),
  priority: String(pick(row, 'priority', 'severity') ?? 'medium').toLowerCase(),
  description: pick(row, 'description', 'summary', 'title', 'text') ?? null,
  technician: pick(row, 'technician', 'assignee', 'assignedTo', 'assigned_to') ?? null,
});

const extractRows = (body) => {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.tickets)) return body.tickets;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.results)) return body.results;
  return [];
};

/**
 * Fetch tickets for a filter. Returns an array of tickets in the agent's shape.
 * Throws on any transport/auth error so the caller can fall back to synthetic
 * data and record the failure.
 *
 * @param {object} filter   { from, to, lineId, limit }
 */
export const fetchTickets = async (filter = {}, { fetchImpl = fetch, values } = {}) => {
  const cfg = values ?? resolve_('integral_portal');
  const base = String(cfg.baseUrl ?? '').replace(/\/$/, '');
  const path = cfg.ticketsPath || DEFAULT_TICKETS_PATH;
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  if (filter.from) url.searchParams.set('from', filter.from);
  if (filter.to) url.searchParams.set('to', filter.to);
  if (filter.lineId) url.searchParams.set('line', filter.lineId);

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        'x-api-key': cfg.apiKey,
        accept: 'application/json',
      },
    },
    fetchImpl,
  );
  if (!response.ok) {
    throw new Error(`Integral Portal returned ${response.status}.`);
  }
  const body = await response.json().catch(() => null);
  const rows = extractRows(body).map(mapTicket);
  logger.info('Integral Portal tickets fetched', { count: rows.length });
  return typeof filter.limit === 'number' ? rows.slice(0, filter.limit) : rows;
};
