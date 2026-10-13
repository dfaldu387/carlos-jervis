import {
  aggregateIssues,
  issueTrend,
  reworkBreakdown,
  searchIssues,
  shiftBreakdown,
  vehicleImpact,
} from './production.js';
import {
  dashboardLookup,
  downtimeEvents,
  maintenanceTickets,
  powerbiMeasures,
} from './systems.js';
import {
  briefingCompose,
  calendarEvents,
  mailDraft,
  mailNeedsReply,
  mailSearch,
  tasksCreate,
  tasksDueTool,
} from './secretary.js';
import { dashboardCreate, powerbiMeasure } from './dashboards.js';

/**
 * Tool registry.
 *
 * The planner selects from this list; the orchestrator executes. Adding a new
 * system means adding a tool here and a plan entry in planner.js - nothing in
 * the transport or UI layer needs to know about it.
 *
 * Every tool carries the permission it needs. The orchestrator checks it
 * before running the tool and reports a withheld tool the same way a redacted
 * column is reported, so the answer says what was held back and why.
 */
const PERMISSIONS = {
  'issues.search': 'production:read',
  'issues.aggregate': 'production:read',
  'issues.vehicleImpact': 'production:read',
  'issues.rework': 'production:read',
  'issues.trend': 'production:read',
  'issues.byShift': 'production:read',
  'powerbi.measures': 'production:read',
  'powerbi.reports': 'production:read',
  'telemetry.downtime': 'production:read',
  'maintenance.tickets': 'maintenance:read',
};

export const TOOLS = Object.fromEntries(
  [
    searchIssues,
    aggregateIssues,
    vehicleImpact,
    reworkBreakdown,
    issueTrend,
    shiftBreakdown,
    powerbiMeasures,
    maintenanceTickets,
    downtimeEvents,
    dashboardLookup,
    mailSearch,
    mailNeedsReply,
    mailDraft,
    calendarEvents,
    tasksDueTool,
    tasksCreate,
    briefingCompose,
    powerbiMeasure,
    dashboardCreate,
  ].map((tool) => [tool.id, { permission: PERMISSIONS[tool.id] ?? null, ...tool }]),
);

export const toolById = (id) => TOOLS[id] ?? null;

export const toolCatalog = () =>
  Object.values(TOOLS).map(({ id, source, label, description, permission }) => ({
    id,
    source,
    label,
    description,
    permission,
  }));
