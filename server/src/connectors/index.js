import { POWERBI_REPORTS, EXTERNAL_APPS } from '../data/catalog.js';
import { INTEGRATIONS } from '../integrations/definitions.js';
import { isConfigured, isEnabled, isLive, publicView } from '../integrations/store.js';

/**
 * Connector registry.
 *
 * Each entry describes one system Jervis sits on top of: what it is, how it is
 * reached, and its honest integration mode. Nothing here replaces the source
 * system - the requirement is explicit that Power BI and Databricks stay in
 * place.
 *
 * `mode` is resolved from the integration store, not guessed:
 *   live    - required credentials present AND the client enabled the connector
 *   mock    - answered from the bundled synthetic warehouse (default)
 *   planned - no probe/data path yet (the existing-chatbot decision)
 */

/** Static descriptors that do not come from credentials. */
const DESCRIPTORS = {
  databricks: {
    kind: 'data-warehouse',
    purpose:
      'Production issue events, rework records and vehicle history. Hosts the existing chatbot application.',
    access: 'SQL warehouse via service principal, read-only scopes',
    objects: ['prod_quality.issue_events', 'prod_quality.vehicle_master'],
    capabilities: ['issue search', 'aggregation', 'rework analysis', 'trend'],
    openUrl: EXTERNAL_APPS.find((app) => app.id === 'legacy-chatbot')?.url ?? null,
    securityNote:
      'Client cannot grant unrestricted access; prototype reads a sanitized data set until a controlled read path is agreed.',
  },
  powerbi: {
    kind: 'bi-dashboards',
    purpose:
      'Management dashboards and published measures. Jervis reads measures and links the user back to the report.',
    access: 'Power BI REST API / executeQueries with a read-only app registration',
    objects: POWERBI_REPORTS.map((report) => report.name),
    capabilities: ['KPI measures', 'report deep links', 'dataset metadata'],
    openUrl: POWERBI_REPORTS[0].url,
    securityNote: 'Cost Center Impact report is restricted to the manager role.',
  },
  integral_portal: {
    kind: 'maintenance',
    purpose: 'Production maintenance portal: tickets, assets, technician assignments.',
    access: 'REST API behind internal network, token issued per environment',
    objects: ['maintenance.tickets', 'maintenance.assets'],
    capabilities: ['open tickets', 'closed work', 'asset history'],
    openUrl: EXTERNAL_APPS.find((app) => app.id === 'integral-portal')?.url ?? null,
    securityNote: 'Access route to be reviewed together with the client.',
  },
  mqtt: {
    kind: 'telemetry',
    purpose: 'Line and asset telemetry, stop and downtime signals.',
    access: 'Broker subscription, topic allow-list per line',
    objects: ['plant1/+/+/state'],
    capabilities: ['downtime events', 'stop reasons'],
    openUrl: EXTERNAL_APPS.find((app) => app.id === 'mqtt-explorer')?.url ?? null,
    securityNote: 'Topic allow-list required before any live subscription.',
  },
  legacy_chatbot: {
    kind: 'application',
    purpose:
      'Databricks application in use for about one year. Discovery decides whether Jervis extends it or wraps it.',
    access: 'To be determined in discovery',
    objects: [],
    capabilities: ['issue lookup', 'summaries', 'issue dimensions'],
    openUrl: EXTERNAL_APPS.find((app) => app.id === 'legacy-chatbot')?.url ?? null,
    securityNote: 'Architecture decision pending: extend, reuse, integrate or wrap.',
  },
};

/** Connectors that have no live data path yet, only a link. */
const PLANNED = new Set(['legacy_chatbot']);

const resolveMode = (id) => {
  if (PLANNED.has(id)) return 'planned';
  return isLive(id) ? 'live' : 'mock';
};

export const buildConnectorRegistry = () => {
  const checks = Object.fromEntries(publicView().map((entry) => [entry.id, entry.lastCheck]));

  return INTEGRATIONS.map((definition) => {
    const descriptor = DESCRIPTORS[definition.id] ?? {};
    return {
      id: definition.id,
      name: definition.name,
      kind: descriptor.kind ?? 'system',
      purpose: descriptor.purpose ?? definition.summary,
      mode: resolveMode(definition.id),
      configured: isConfigured(definition.id),
      enabled: isEnabled(definition.id),
      lastCheck: checks[definition.id] ?? null,
      access: descriptor.access ?? '',
      objects: descriptor.objects ?? [],
      capabilities: descriptor.capabilities ?? [],
      openUrl: descriptor.openUrl ?? null,
      securityNote: descriptor.securityNote ?? '',
    };
  });
};

export const connectorById = (id) =>
  buildConnectorRegistry().find((connector) => connector.id === id) ?? null;

/** Source labels used in answer citations. */
export const SOURCE_LABELS = {
  databricks: 'Databricks',
  powerbi: 'Power BI',
  integral_portal: 'Integral Portal',
  mqtt: 'MQTT Explorer',
  catalog: 'Reference data',
};
