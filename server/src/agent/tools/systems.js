import { getRepository } from '../../data/index.js';
import { fetchMeasures } from '../../connectors/powerbi.connector.js';
import { fetchTickets } from '../../connectors/integral.connector.js';
import { getLiveDowntimeBuffer } from '../../connectors/mqtt.ingest.js';
import { isLive } from '../../integrations/store.js';
import { logger } from '../../utils/logger.js';
import { POWERBI_REPORTS } from '../../data/catalog.js';
import { lineLabel } from '../labels.js';

/** Tools that reach the surrounding systems: Power BI, Integral Portal, MQTT. */

export const powerbiMeasures = {
  id: 'powerbi.measures',
  source: 'powerbi',
  label: 'Power BI measures',
  description: 'Read published dashboard measures and the deep link back to the report.',
  async run({ filter, permissions }) {
    const includeRestricted = permissions.includes('finance:read');
    const result = await fetchMeasures(filter, { includeRestricted });
    return {
      data: result,
      citation: {
        source: 'powerbi',
        object: 'Production Quality Overview',
        detail: `${result.measures.length} measures`,
        url: POWERBI_REPORTS[0].url,
      },
    };
  },
};

export const maintenanceTickets = {
  id: 'maintenance.tickets',
  source: 'integral_portal',
  label: 'Maintenance tickets',
  description: 'Maintenance work recorded in the Integral Portal for the period.',
  async run({ filter, limit = 6 }) {
    let rows;
    let live = false;
    // Prefer the live portal when it is configured and enabled; fall back to
    // the synthetic tickets on any failure so the question is still answered.
    if (isLive('integral_portal')) {
      try {
        rows = await fetchTickets({ ...filter, limit });
        live = true;
      } catch (error) {
        logger.warn('Integral Portal fetch failed; using synthetic tickets', { error: error.message });
      }
    }
    if (!rows) {
      rows = await getRepository().listMaintenance({ ...filter, limit });
    }
    const open = rows.filter((row) => row.status === 'open').length;
    return {
      data: { rows, open, total: rows.length, live },
      citation: {
        source: 'integral_portal',
        object: 'maintenance.tickets',
        detail: `${rows.length} tickets, ${open} still open`,
        url: 'https://integral.internal/maintenance',
      },
    };
  },
};

export const downtimeEvents = {
  id: 'telemetry.downtime',
  source: 'mqtt',
  label: 'Downtime signals',
  description: 'Line stop and downtime events from the MQTT broker.',
  async run({ filter, limit = 6 }) {
    // Prefer live downtime captured from the MQTT broker when the connector is
    // live and has recorded events; otherwise read the synthetic telemetry.
    let rows;
    const buffer = getLiveDowntimeBuffer();
    if (isLive('mqtt') && buffer && buffer.size > 0) {
      rows = buffer.list({ ...filter, limit });
    } else {
      rows = await getRepository().listDowntime({ ...filter, limit });
    }
    const totalMinutes = rows.reduce((sum, row) => sum + row.durationMinutes, 0);
    const byLine = new Map();
    for (const row of rows) {
      byLine.set(row.lineId, (byLine.get(row.lineId) ?? 0) + row.durationMinutes);
    }
    return {
      data: {
        rows,
        totalMinutes,
        byLine: [...byLine.entries()]
          .map(([lineId, minutes]) => ({ lineId, label: lineLabel(lineId), minutes }))
          .sort((a, b) => b.minutes - a.minutes),
      },
      citation: {
        source: 'mqtt',
        object: 'plant1/+/+/state',
        detail: `${rows.length} stop events, ${totalMinutes} minutes`,
      },
    };
  },
};

export const dashboardLookup = {
  id: 'powerbi.reports',
  source: 'powerbi',
  label: 'Dashboard directory',
  description: 'Point the user at the report that owns the requested figures.',
  async run({ permissions }) {
    const includeRestricted = permissions.includes('finance:read');
    const reports = POWERBI_REPORTS.filter((report) => includeRestricted || !report.restricted);
    return {
      data: {
        reports: reports.map((report) => ({
          id: report.id,
          name: report.name,
          workspace: report.workspace,
          url: report.url,
          measures: report.measures,
          dimensions: report.dimensions,
        })),
        hiddenCount: POWERBI_REPORTS.length - reports.length,
      },
      citation: {
        source: 'powerbi',
        object: 'Workspace catalog',
        detail: `${reports.length} reports available to this role`,
      },
    };
  },
};
