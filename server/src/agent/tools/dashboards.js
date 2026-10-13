import { MEASURE_ALIASES, fetchMeasures } from '../../connectors/powerbi.connector.js';
import { POWERBI_REPORTS } from '../../data/catalog.js';
import { buildDashboard } from '../../dashboards/builder.js';
import { recordAudit } from '../../security/audit.js';

/** Power BI measure lookup by name, and dashboards built on request. */

const tokens = (text) =>
  String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/)
    .filter((token) => token.length > 1);

/**
 * Fuzzy match of what the user said against each measure's key, label and
 * aliases: whole-phrase containment scores highest, then token overlap.
 */
export const matchMeasure = (query, measures) => {
  const q = String(query ?? '').toLowerCase().trim();
  const qTokens = tokens(q);
  if (!q) return null;

  let best = null;
  for (const measure of measures) {
    const names = [measure.key.replace(/_/g, ' '), measure.label.replace(/\s*\(est\.\)/i, ''), ...(MEASURE_ALIASES[measure.key] ?? [])].map((name) =>
      name.toLowerCase(),
    );
    let score = 0;
    for (const name of names) {
      if (name === q) score = Math.max(score, 100);
      else if (q.includes(name) || name.includes(q)) score = Math.max(score, 60 + Math.min(name.length, 20));
      const overlap = tokens(name).filter((token) => qTokens.includes(token)).length;
      if (overlap > 0) score = Math.max(score, overlap * 15);
    }
    if (score > 0 && (!best || score > best.score)) best = { measure, score };
  }
  return best && best.score >= 15 ? best : null;
};

const unitFor = (format) => ({ percent: '%', minutes: 'min', currency: 'EUR' }[format] ?? '');

const displayValue = (measure) => {
  if (measure.value === null || measure.value === undefined) return null;
  if (measure.format === 'percent') return Number((measure.value * 100).toFixed(1));
  return Math.round(measure.value * 100) / 100;
};

export const powerbiMeasure = {
  id: 'powerbi.measure',
  source: 'powerbi',
  label: 'Power BI measure',
  description: 'Look up one published measure by name and return its value, unit, report and link.',
  permission: 'production:read',
  async run({ filter, interpretation, permissions = [], query }) {
    const includeRestricted = permissions.includes('finance:read');
    const result = await fetchMeasures(filter, { includeRestricted });
    const asked = query ?? interpretation?.entities?.measureQuery ?? interpretation?.question ?? '';
    const match = matchMeasure(asked, result.measures);
    const available = result.measures.map((measure) => measure.label);

    if (!match) {
      return {
        data: { measure: null, query: asked, available },
        citation: { source: 'powerbi', object: 'Measures', detail: `no measure matched "${asked}"` },
      };
    }

    const { measure } = match;
    const report = POWERBI_REPORTS.find((entry) => entry.id === measure.report) ?? POWERBI_REPORTS[0];
    const data = {
      measure: {
        key: measure.key,
        name: measure.label,
        value: displayValue(measure),
        rawValue: measure.value,
        unit: unitFor(measure.format),
        format: measure.format,
        report: report.name,
        workspace: report.workspace,
        url: report.url,
        restricted: Boolean(measure.restricted),
        score: match.score,
      },
      query: asked,
      available,
    };
    return {
      data,
      citation: { source: 'powerbi', object: report.name, detail: `${measure.label} = ${data.measure.value ?? 'n/a'}${data.measure.unit}`, url: report.url },
    };
  },
};

export const dashboardCreate = {
  id: 'dashboard.create',
  source: 'dashboards',
  label: 'Create dashboard',
  description: 'Build and save a simple dashboard from the question, using the production tools.',
  permission: 'dashboards:write',
  async run({ interpretation, access, language }) {
    const dashboard = await buildDashboard({
      question: interpretation.question,
      title: interpretation.entities?.dashboardTitle ?? null,
      language,
      createdBy: access?.userId ?? 'demo-user',
    });
    recordAudit({
      access,
      action: 'dashboard.create',
      resource: dashboard.id,
      outcome: 'ok',
      detail: `agent: ${dashboard.title} (${dashboard.widgets.length} widgets)`,
    });
    return {
      data: { dashboard },
      citation: { source: 'dashboards', object: 'dashboards.json', detail: `created ${dashboard.id} with ${dashboard.widgets.length} widgets` },
    };
  },
};
