import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

/**
 * Dashboard definitions.
 *
 * A dashboard is a saved question: its title, the period and filters the
 * question resolved to, and the list of widgets with the query each one runs.
 * The widget data stored here is a snapshot from creation time; GET /:id
 * recomputes it from the repository (see builder.js), so a dashboard never
 * shows stale figures.
 *
 * In-memory, persisted to server/data/dashboards.json after every write. A
 * missing file is normal; JERVIS_DASHBOARDS_FILE isolates test runs.
 */

const here = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = process.env.JERVIS_DASHBOARDS_FILE ?? resolve(here, '../../data/dashboards.json');

let dashboards = null;

const load = () => {
  if (dashboards) return dashboards;
  try {
    if (existsSync(STORE_PATH)) {
      const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
      dashboards = Array.isArray(parsed) ? parsed : [];
    } else {
      dashboards = [];
    }
  } catch (error) {
    logger.warn('Could not read the dashboard store; starting empty', { error: error.message });
    dashboards = [];
  }
  return dashboards;
};

const persist = () => {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(dashboards, null, 2));
  } catch (error) {
    logger.warn('Could not persist the dashboard store', { error: error.message });
  }
};

export const listDashboards = () =>
  [...load()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((dashboard) => ({
      id: dashboard.id,
      title: dashboard.title,
      question: dashboard.question,
      createdAt: dashboard.createdAt,
      createdBy: dashboard.createdBy,
      widgetCount: dashboard.widgets.length,
    }));

export const getDashboard = (id) => load().find((dashboard) => dashboard.id === id) ?? null;

export const saveDashboard = (dashboard) => {
  const rows = load();
  const index = rows.findIndex((entry) => entry.id === dashboard.id);
  if (index >= 0) rows[index] = dashboard;
  else rows.push(dashboard);
  persist();
  return dashboard;
};

export const deleteDashboard = (id) => {
  const rows = load();
  const index = rows.findIndex((dashboard) => dashboard.id === id);
  if (index < 0) return false;
  rows.splice(index, 1);
  persist();
  return true;
};

/** Test hook. */
export const resetDashboards = () => {
  dashboards = [];
  try {
    if (existsSync(STORE_PATH)) writeFileSync(STORE_PATH, '[]');
  } catch {
    /* ignore */
  }
};

export const dashboardStorePath = () => STORE_PATH;
