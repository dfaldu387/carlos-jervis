/**
 * Reference data for the prototype.
 *
 * These are the dimensions the client demonstrated during the October 5
 * meeting: production lines, shifts, vehicle models, error codes, symptoms,
 * parts, cost centers, checkpoints and rework categories. Values are synthetic
 * stand-ins with realistic shape - no Mercedes internal data is used, which is
 * what the security constraint in the requirements calls for.
 */

export const PLANT = { id: 'PL-01', name: 'Plant 1', location: 'Assembly Plant' };

export const LINES = [
  { id: 'BS1', name: 'Body Shop Line 1', area: 'Body Shop', costCenter: 'CC-4120' },
  { id: 'PL2', name: 'Paint Line 2', area: 'Paint Shop', costCenter: 'CC-4230' },
  { id: 'FA1', name: 'Final Assembly 1', area: 'Final Assembly', costCenter: 'CC-4410' },
  { id: 'FA2', name: 'Final Assembly 2', area: 'Final Assembly', costCenter: 'CC-4415' },
];

export const MODELS = [
  { id: 'W206', name: 'C-Class (W206)', lines: ['BS1', 'PL2', 'FA1'] },
  { id: 'W214', name: 'E-Class (W214)', lines: ['BS1', 'PL2', 'FA1'] },
  { id: 'X254', name: 'GLC (X254)', lines: ['BS1', 'PL2', 'FA2'] },
  { id: 'V295', name: 'EQE (V295)', lines: ['PL2', 'FA2'] },
  { id: 'VS30', name: 'Sprinter (VS30)', lines: ['FA2'] },
];

export const COST_CENTERS = [
  { id: 'CC-4120', name: 'Body Shop Operations', area: 'Body Shop' },
  { id: 'CC-4230', name: 'Paint Shop Operations', area: 'Paint Shop' },
  { id: 'CC-4410', name: 'Final Assembly A', area: 'Final Assembly' },
  { id: 'CC-4415', name: 'Final Assembly B', area: 'Final Assembly' },
  { id: 'CC-4505', name: 'Quality Assurance', area: 'Quality' },
];

export const CHECKPOINTS = [
  { id: 'CP-10', name: 'Geometry Station', line: 'BS1' },
  { id: 'CP-22', name: 'Paint Visual Inspection', line: 'PL2' },
  { id: 'CP-35', name: 'Electrical Test', line: 'FA1' },
  { id: 'CP-48', name: 'Roller Test Bench', line: 'FA2' },
  { id: 'CP-60', name: 'Final Audit', line: 'FA1' },
];

export const PARTS = [
  { id: 'TQ-18', name: 'Torque fixture TQ-18', supplier: 'Fixture Systems GmbH', costCenter: 'CC-4120' },
  { id: 'FDS-220', name: 'Front door seal FDS-220', supplier: 'SealTech AG', costCenter: 'CC-4410' },
  { id: 'WH-4410', name: 'Wiring harness WH-4410', supplier: 'Nordkabel AG', costCenter: 'CC-4410' },
  { id: 'BL-77', name: 'Brake line BL-77', supplier: 'HydroBrake SA', costCenter: 'CC-4415' },
  { id: 'HL-302', name: 'Headlamp module HL-302', supplier: 'Lumen Industries', costCenter: 'CC-4415' },
  { id: 'SN-11', name: 'Sealant nozzle SN-11', supplier: 'Applicator Works', costCenter: 'CC-4230' },
  { id: 'ECU-9', name: 'ECU module ECU-9', supplier: 'Elektron Systems', costCenter: 'CC-4410' },
  { id: 'PNL-55', name: 'Rear panel PNL-55', supplier: 'PressWerk GmbH', costCenter: 'CC-4120' },
];

export const ERROR_CODES = [
  {
    code: 'E-1042',
    description: 'Torque value out of specification',
    category: 'Mechanical',
    symptom: 'Bolt torque below tolerance at geometry station',
    lines: ['BS1', 'FA1'],
    parts: ['TQ-18', 'PNL-55'],
    checkpoints: ['CP-10', 'CP-60'],
    weight: 9,
  },
  {
    code: 'E-2051',
    description: 'Paint surface defect (orange peel)',
    category: 'Surface',
    symptom: 'Visible orange peel texture on clear coat',
    lines: ['PL2'],
    parts: ['SN-11'],
    checkpoints: ['CP-22'],
    weight: 8,
  },
  {
    code: 'E-3310',
    description: 'Gap and flush deviation',
    category: 'Dimensional',
    symptom: 'Door gap outside tolerance band',
    lines: ['BS1', 'FA1', 'FA2'],
    parts: ['FDS-220', 'PNL-55'],
    checkpoints: ['CP-10', 'CP-60'],
    weight: 7,
  },
  {
    code: 'E-4120',
    description: 'Wiring harness misroute',
    category: 'Electrical',
    symptom: 'Harness clip missing, cable routed outside channel',
    lines: ['FA1', 'FA2'],
    parts: ['WH-4410'],
    checkpoints: ['CP-35'],
    weight: 8,
  },
  {
    code: 'E-5007',
    description: 'Sealant application incomplete',
    category: 'Surface',
    symptom: 'Sealant bead interrupted along seam',
    lines: ['PL2', 'BS1'],
    parts: ['SN-11'],
    checkpoints: ['CP-22'],
    weight: 6,
  },
  {
    code: 'E-6233',
    description: 'Control unit software flash failure',
    category: 'Software',
    symptom: 'Flash sequence aborts at electrical test',
    lines: ['FA1', 'FA2'],
    parts: ['ECU-9'],
    checkpoints: ['CP-35'],
    weight: 7,
  },
  {
    code: 'E-7781',
    description: 'Brake line connection leak',
    category: 'Safety',
    symptom: 'Pressure drop detected on brake circuit',
    lines: ['FA2'],
    parts: ['BL-77'],
    checkpoints: ['CP-48'],
    weight: 4,
  },
  {
    code: 'E-8150',
    description: 'Door seal not seated',
    category: 'Mechanical',
    symptom: 'Wind noise and water ingress risk at door seal',
    lines: ['FA1', 'FA2'],
    parts: ['FDS-220'],
    checkpoints: ['CP-60'],
    weight: 6,
  },
  {
    code: 'E-9002',
    description: 'Headlamp alignment out of range',
    category: 'Electrical',
    symptom: 'Headlamp beam angle fails roller test',
    lines: ['FA2'],
    parts: ['HL-302'],
    checkpoints: ['CP-48'],
    weight: 5,
  },
];

export const REWORK_CATEGORIES = [
  { id: 'RW-IN', name: 'Rework in line', removesVehicle: false },
  { id: 'RW-OFF', name: 'Offline rework', removesVehicle: true },
  { id: 'RW-REMOVED', name: 'Removed from line', removesVehicle: true },
  { id: 'RW-HOLD', name: 'Quality hold', removesVehicle: true },
  { id: 'RW-NONE', name: 'No rework required', removesVehicle: false },
];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

export const ASSETS = [
  { id: 'AS-101', name: 'Welding robot R12', line: 'BS1' },
  { id: 'AS-204', name: 'Paint atomizer A4', line: 'PL2' },
  { id: 'AS-311', name: 'Torque station T7', line: 'FA1' },
  { id: 'AS-420', name: 'Roller test bench RB2', line: 'FA2' },
  { id: 'AS-505', name: 'Conveyor segment C9', line: 'FA1' },
];

/** Power BI reports the client already runs; Jervis points back at them. */
export const POWERBI_REPORTS = [
  {
    id: 'pbi-production-quality',
    name: 'Production Quality Overview',
    workspace: 'Manufacturing Analytics',
    url: 'https://app.powerbi.com/groups/manufacturing/reports/production-quality',
    measures: ['issues_total', 'first_pass_yield', 'rework_rate'],
    dimensions: ['date', 'shift', 'line', 'model'],
  },
  {
    id: 'pbi-rework-tracking',
    name: 'Rework and Vehicle Tracking',
    workspace: 'Manufacturing Analytics',
    url: 'https://app.powerbi.com/groups/manufacturing/reports/rework-tracking',
    measures: ['vehicles_reworked', 'vehicles_removed', 'rework_minutes'],
    dimensions: ['date', 'shift', 'line', 'rework_category'],
  },
  {
    id: 'pbi-cost-center',
    name: 'Cost Center Impact',
    workspace: 'Finance and Operations',
    url: 'https://app.powerbi.com/groups/finance/reports/cost-center-impact',
    measures: ['rework_cost', 'downtime_cost'],
    dimensions: ['date', 'cost_center', 'line'],
    restricted: true,
  },
];

export const EXTERNAL_APPS = [
  {
    id: 'integral-portal',
    name: 'Integral Portal',
    purpose: 'Production maintenance portal',
    url: 'https://integral.internal/maintenance',
  },
  {
    id: 'mqtt-explorer',
    name: 'MQTT Explorer',
    purpose: 'Live line telemetry and downtime signals',
    url: 'mqtt://broker.internal:1883',
  },
  {
    id: 'legacy-chatbot',
    name: 'Existing production chatbot',
    purpose: 'Databricks app in use for about one year',
    url: 'https://databricks.internal/apps/production-chatbot',
  },
];

export const catalog = {
  plant: PLANT,
  lines: LINES,
  models: MODELS,
  costCenters: COST_CENTERS,
  checkpoints: CHECKPOINTS,
  parts: PARTS,
  errorCodes: ERROR_CODES,
  reworkCategories: REWORK_CATEGORIES,
  severities: SEVERITIES,
  assets: ASSETS,
  powerbiReports: POWERBI_REPORTS,
  externalApps: EXTERNAL_APPS,
};
