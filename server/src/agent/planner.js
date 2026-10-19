import { INTENTS } from './nlu.js';

/**
 * Planner: intent -> retrieval plan.
 *
 * This is the "determines relevant data sources" step from the requirement
 * document. Keeping it as an explicit table (rather than letting a model
 * improvise) is what makes the agent auditable: for any question you can show
 * the client exactly which systems were going to be touched and why.
 */

const issueDetail = (dimension, reason) => ({
  tool: 'issues.aggregate',
  args: { dimension },
  reason,
});

const PLANS = {
  [INTENTS.ISSUE_SUMMARY]: [
    { tool: 'issues.aggregate', args: { dimension: 'errorCode' }, reason: 'Identify the dominant problem codes' },
    { tool: 'issues.aggregate', args: { dimension: 'lineId' }, reason: 'Locate where the problems occurred' },
    { tool: 'issues.vehicleImpact', reason: 'Size the impact in vehicles' },
    { tool: 'issues.search', args: { limit: 6 }, reason: 'Pull representative issue records' },
    { tool: 'powerbi.measures', reason: 'Align the figures with the management dashboard' },
  ],
  [INTENTS.DAILY_SUMMARY]: [
    { tool: 'powerbi.measures', reason: 'Headline production KPIs for the period' },
    { tool: 'issues.byShift', reason: 'Break the day down by shift' },
    { tool: 'issues.aggregate', args: { dimension: 'errorCode' }, reason: 'Top problem codes' },
    { tool: 'issues.aggregate', args: { dimension: 'lineId' }, reason: 'Affected production lines' },
    { tool: 'issues.rework', reason: 'Rework and vehicles removed from the line' },
    { tool: 'maintenance.tickets', args: { limit: 5 }, reason: 'Maintenance work in the same period' },
    { tool: 'telemetry.downtime', args: { limit: 5 }, reason: 'Line stops recorded by telemetry' },
  ],
  [INTENTS.SHIFT_SUMMARY]: [
    { tool: 'issues.byShift', reason: 'Compare the three production shifts' },
    { tool: 'issues.aggregate', args: { dimension: 'errorCode' }, reason: 'Problem codes in the shift' },
    { tool: 'issues.vehicleImpact', reason: 'Vehicles affected in the shift' },
    { tool: 'telemetry.downtime', args: { limit: 5 }, reason: 'Stops during the shift' },
    { tool: 'powerbi.measures', reason: 'Shift KPIs as published in Power BI' },
  ],
  [INTENTS.TOP_ERROR_CODES]: [
    issueDetail('errorCode', 'Rank the error codes that occurred'),
    { tool: 'issues.search', args: { limit: 5 }, reason: 'Show example occurrences' },
    { tool: 'issues.vehicleImpact', reason: 'Vehicles behind those codes' },
  ],
  [INTENTS.AFFECTED_MODELS]: [
    issueDetail('modelId', 'Rank the affected vehicle models'),
    issueDetail('errorCode', 'Explain what the models were affected by'),
    { tool: 'issues.vehicleImpact', reason: 'Total vehicles involved' },
  ],
  [INTENTS.LINE_ISSUES]: [
    issueDetail('lineId', 'Rank production lines by issue count'),
    issueDetail('errorCode', 'Dominant problem per period'),
    { tool: 'telemetry.downtime', args: { limit: 5 }, reason: 'Downtime on the affected lines' },
    { tool: 'powerbi.measures', reason: 'Line KPIs from the dashboard' },
  ],
  [INTENTS.PARTS_INVOLVED]: [
    issueDetail('partId', 'Rank the parts and components involved'),
    issueDetail('errorCode', 'Tie parts back to problem codes'),
    { tool: 'issues.search', args: { limit: 5 }, reason: 'Example records naming the parts' },
  ],
  [INTENTS.VEHICLE_COUNT]: [
    { tool: 'issues.vehicleImpact', reason: 'Count distinct vehicles affected' },
    issueDetail('modelId', 'Split the vehicles by model'),
    { tool: 'powerbi.measures', reason: 'Cross-check against the dashboard measure' },
  ],
  [INTENTS.REWORK_COUNT]: [
    { tool: 'issues.rework', reason: 'Rework categories and removed vehicles' },
    { tool: 'issues.vehicleImpact', reason: 'Vehicle counts behind the rework' },
    { tool: 'powerbi.measures', reason: 'Compare with the rework tracking report' },
  ],
  [INTENTS.CHECKPOINT_DETECTION]: [
    issueDetail('checkpointId', 'Which checkpoints detected the issues'),
    issueDetail('errorCode', 'What each checkpoint caught'),
  ],
  [INTENTS.COST_CENTER_IMPACT]: [
    issueDetail('costCenter', 'Distribute issues across cost centers'),
    { tool: 'issues.rework', reason: 'Rework effort driving the cost' },
    { tool: 'powerbi.measures', reason: 'Cost measures from the Finance workspace' },
  ],
  [INTENTS.MAINTENANCE_STATUS]: [
    { tool: 'maintenance.tickets', args: { limit: 8 }, reason: 'Maintenance tickets in the period' },
    { tool: 'telemetry.downtime', args: { limit: 5 }, reason: 'Stops the maintenance relates to' },
    issueDetail('lineId', 'Production issues on the same lines'),
  ],
  [INTENTS.DOWNTIME]: [
    { tool: 'telemetry.downtime', args: { limit: 8 }, reason: 'Downtime events and stop reasons' },
    { tool: 'maintenance.tickets', args: { limit: 5 }, reason: 'Maintenance behind the stops' },
    issueDetail('lineId', 'Quality issues on the stopped lines'),
  ],
  [INTENTS.TREND]: [
    { tool: 'issues.trend', reason: 'Daily issue counts across the period' },
    issueDetail('errorCode', 'What drives the trend'),
    { tool: 'powerbi.measures', reason: 'Period KPIs' },
  ],
  [INTENTS.DASHBOARD_LOOKUP]: [
    { tool: 'powerbi.reports', reason: 'Locate the report that owns these figures' },
    { tool: 'powerbi.measures', reason: 'Current values of the headline measures' },
  ],

  // ---- secretary ------------------------------------------------------------
  [INTENTS.INBOX_SUMMARY]: [
    { tool: 'mail.search', args: { limit: 8 }, reason: 'List the inbox with the requested filter' },
    { tool: 'mail.needsReply', args: { limit: 3 }, reason: 'The messages that still need an answer' },
  ],
  [INTENTS.MAIL_SEARCH]: [
    { tool: 'mail.search', args: { limit: 5, mailFilter: 'all' }, reason: 'Search sender, subject and body' },
  ],
  [INTENTS.CALENDAR_TODAY]: [
    { tool: 'calendar.events', reason: 'Appointments for the requested day' },
    { tool: 'tasks.due', reason: 'Tasks due the same day' },
  ],
  [INTENTS.DAILY_BRIEFING]: [
    { tool: 'briefing.compose', reason: 'Calendar, inbox, tasks, production and maintenance in one pass' },
  ],
  [INTENTS.CREATE_REMINDER]: [
    { tool: 'tasks.create', reason: 'Create the task with the parsed due time' },
  ],
  [INTENTS.DRAFT_REPLY]: [
    { tool: 'mail.draft', reason: 'Find the message and draft the reply (nothing is sent)' },
  ],
  [INTENTS.POWERBI_MEASURE]: [
    { tool: 'powerbi.measure', reason: 'Look up the named measure and its report' },
  ],
  [INTENTS.CREATE_DASHBOARD]: [
    { tool: 'dashboard.create', reason: 'Build the dashboard from the production tools and save it' },
  ],
  [INTENTS.TRIGGER_FLOW]: [
    { tool: 'automate.trigger', reason: 'Resolve the named flow and propose it for an explicit confirmation' },
  ],
  [INTENTS.DOCUMENT_QUESTION]: [
    { tool: 'documents.search', reason: 'Find the relevant passages in approved documents and cite them' },
  ],
};

/** Intents that are answered without touching a data source. */
export const CONVERSATIONAL_INTENTS = new Set([
  INTENTS.GREETING,
  INTENTS.CAPABILITIES,
  INTENTS.UNKNOWN,
]);

export const plan = (interpretation, { permissions = [] } = {}) => {
  const steps = PLANS[interpretation.intent] ?? [];

  return steps
    .filter((step) => {
      // Cost figures stay behind the finance permission; the plan drops the
      // step rather than retrieving and redacting it.
      if (interpretation.intent === INTENTS.COST_CENTER_IMPACT && step.tool === 'powerbi.measures') {
        return permissions.includes('finance:read');
      }
      return true;
    })
    .map((step, index) => ({
      order: index + 1,
      tool: step.tool,
      args: step.args ?? {},
      reason: step.reason,
    }));
};
