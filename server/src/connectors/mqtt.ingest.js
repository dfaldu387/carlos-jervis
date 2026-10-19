import { logger } from '../utils/logger.js';

/**
 * MQTT downtime ingestion.
 *
 * Turns line-state messages into downtime events. A line publishes "stopped" or
 * "running" (or a JSON body) on plant1/<line>/<asset>/state; a stop followed by
 * a run becomes one downtime event with a duration, in the same shape the
 * repository returns, so the downtime tool and every answer read it unchanged.
 *
 * The parser and the stop→event buffer below are pure and unit-tested. The
 * remaining piece is the broker subscriber that feeds `ingest()` with live
 * PUBLISH messages: it is intentionally not written yet because the topic
 * pattern and payload format are still open questions for Carlos and there is
 * no broker to verify binary MQTT decoding against. Once both are confirmed, a
 * subscriber (building on the CONNECT framing in integrations/probe.js, adding
 * SUBSCRIBE and PUBLISH decode) calls `buffer.ingest(topic, payload)` and the
 * downtime tool reads from the buffer via `getLiveDowntimeBuffer()`.
 */

const SHIFT_FOR_HOUR = (hour) => {
  if (hour >= 6 && hour < 14) return 'S1';
  if (hour >= 14 && hour < 22) return 'S2';
  return 'S3';
};

const toDateKey = (date) => date.toISOString().slice(0, 10);

/**
 * Parse one state message.
 * @returns {{ lineId, assetId, state: 'stopped'|'running', reason: string|null } | null}
 */
export const parseStateMessage = (topic, payload) => {
  const parts = String(topic).split('/');
  // plant1/<line>/<asset>/state
  if (parts.length < 4 || parts[parts.length - 1] !== 'state') return null;
  let lineId = parts[1];
  let assetId = parts[2];
  const raw = String(payload ?? '').trim();

  let state;
  let reason = null;
  if (raw.startsWith('{')) {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return null;
    }
    state = normaliseState(body.state);
    reason = body.reason ?? null;
    if (body.line) lineId = String(body.line);
    if (body.asset) assetId = String(body.asset);
  } else {
    state = normaliseState(raw);
  }
  if (!state) return null;
  return { lineId, assetId, state, reason };
};

const normaliseState = (value) => {
  const s = String(value ?? '').toLowerCase();
  if (['stopped', 'stop', 'down', 'fault', 'false', '0'].includes(s)) return 'stopped';
  if (['running', 'run', 'up', 'ok', 'true', '1'].includes(s)) return 'running';
  return null;
};

/**
 * Buffers open stops per asset and emits a completed downtime event when the
 * asset reports running again. Keeps the most recent `retain` events.
 */
export class DowntimeBuffer {
  constructor({ retain = 2000, now = () => new Date() } = {}) {
    this.retain = retain;
    this.now = now;
    this.openStops = new Map(); // assetId -> { startedAt, reason, lineId, topic }
    this.events = [];
    this.sequence = 0;
  }

  ingest(topic, payload) {
    const parsed = parseStateMessage(topic, payload);
    if (!parsed) return null;
    const key = `${parsed.lineId}/${parsed.assetId}`;

    if (parsed.state === 'stopped') {
      // First stop wins; a repeated "stopped" does not reset the clock.
      if (!this.openStops.has(key)) {
        this.openStops.set(key, {
          startedAt: this.now(),
          reason: parsed.reason,
          lineId: parsed.lineId,
          assetId: parsed.assetId,
          topic,
        });
      }
      return null;
    }

    // running: close an open stop into a downtime event.
    const open = this.openStops.get(key);
    if (!open) return null;
    this.openStops.delete(key);
    const endedAt = this.now();
    const durationMinutes = Math.max(0, Math.round((endedAt - open.startedAt) / 60000));
    const startHour = open.startedAt.getHours();
    const event = {
      id: `DT-LIVE-${String(++this.sequence).padStart(5, '0')}`,
      date: toDateKey(open.startedAt),
      shiftId: SHIFT_FOR_HOUR(startHour),
      lineId: open.lineId,
      assetId: open.assetId,
      topic: open.topic,
      startedAt: open.startedAt.toISOString(),
      durationMinutes,
      reason: open.reason ?? parsed.reason ?? null,
    };
    this.events.unshift(event);
    if (this.events.length > this.retain) this.events.length = this.retain;
    return event;
  }

  /** Downtime events matching a repository-style filter, newest first. */
  list(filter = {}) {
    let rows = this.events;
    if (filter.from) rows = rows.filter((r) => r.date >= filter.from);
    if (filter.to) rows = rows.filter((r) => r.date <= filter.to);
    if (filter.lineId) rows = rows.filter((r) => r.lineId === filter.lineId);
    if (filter.shiftId) rows = rows.filter((r) => r.shiftId === filter.shiftId);
    const sorted = [...rows].sort((a, b) => b.durationMinutes - a.durationMinutes);
    return typeof filter.limit === 'number' ? sorted.slice(0, filter.limit) : sorted;
  }

  get size() {
    return this.events.length;
  }
}

// Process-wide buffer the ingestion service fills and the downtime tool reads.
let liveBuffer = null;
export const getLiveDowntimeBuffer = () => liveBuffer;
export const setLiveDowntimeBuffer = (buffer) => {
  liveBuffer = buffer;
};
