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

/**
 * Tool registry.
 *
 * The planner selects from this list; the orchestrator executes. Adding a new
 * system means adding a tool here and a plan entry in planner.js - nothing in
 * the transport or UI layer needs to know about it.
 */
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
  ].map((tool) => [tool.id, tool]),
);

export const toolById = (id) => TOOLS[id] ?? null;

export const toolCatalog = () =>
  Object.values(TOOLS).map(({ id, source, label, description }) => ({
    id,
    source,
    label,
    description,
  }));
