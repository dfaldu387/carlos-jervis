import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId } from '../utils/ids.js';
import { addDays, now, toIsoDate } from '../utils/dates.js';
import { logger } from '../utils/logger.js';

/**
 * Reminders and tasks.
 *
 * In-memory list seeded with four tasks for the demo, persisted to
 * server/data/tasks.json after every write. A missing file is normal (first
 * boot, or a fresh checkout - the file is local state and is not committed);
 * the seed is used and the file appears on the first change. Point
 * JERVIS_TASKS_FILE elsewhere to isolate test runs.
 *
 * Task: { id, title, dueAt: ISO|null, status: 'open'|'done', source:
 *         'manual'|'mail'|'jervis', relatedMailId, createdAt, createdBy }
 */

const here = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = process.env.JERVIS_TASKS_FILE ?? resolve(here, '../../data/tasks.json');

export const TASK_STATUSES = ['open', 'done'];
export const TASK_SOURCES = ['manual', 'mail', 'jervis'];

const stamp = (daysFromNow, time) => `${toIsoDate(addDays(now(), daysFromNow))}T${time}:00Z`;

const seed = () => [
  {
    id: 'task_seed_1',
    title: 'Approve E-7781 containment plan (Jonas Vogel)',
    dueAt: stamp(0, '10:00'),
    status: 'open',
    source: 'mail',
    relatedMailId: 'mail_003',
    createdAt: stamp(-1, '08:30'),
    createdBy: 'usr_manager',
  },
  {
    id: 'task_seed_2',
    title: 'Send downtime per line to Thomas Reuter for the management meeting',
    dueAt: stamp(-1, '16:00'),
    status: 'open',
    source: 'mail',
    relatedMailId: 'mail_015',
    createdAt: stamp(-2, '17:10'),
    createdBy: 'usr_manager',
  },
  {
    id: 'task_seed_3',
    title: 'Confirm the shift plan for the next period with HR',
    dueAt: stamp(2, '12:00'),
    status: 'open',
    source: 'manual',
    relatedMailId: 'mail_007',
    createdAt: stamp(-1, '11:20'),
    createdBy: 'usr_manager',
  },
  {
    id: 'task_seed_4',
    title: 'Book the TQ-18 service visit with Fixture Systems',
    dueAt: null,
    status: 'done',
    source: 'manual',
    relatedMailId: 'mail_021',
    createdAt: stamp(-3, '09:00'),
    createdBy: 'usr_manager',
  },
];

let tasks = null;

const load = () => {
  if (tasks) return tasks;
  try {
    if (existsSync(STORE_PATH)) {
      const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
      tasks = Array.isArray(parsed) ? parsed : seed();
    } else {
      tasks = seed();
    }
  } catch (error) {
    logger.warn('Could not read the task store; using the seed', { error: error.message });
    tasks = seed();
  }
  return tasks;
};

const persist = () => {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(tasks, null, 2));
  } catch (error) {
    // The list stays usable in memory; losing the file is logged, not fatal.
    logger.warn('Could not persist the task store', { error: error.message });
  }
};

const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });

const normaliseDue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid('dueAt must be an ISO 8601 timestamp.');
  return date.toISOString();
};

const normaliseTitle = (value) => {
  const title = String(value ?? '').trim();
  if (!title) throw invalid('title is required.');
  if (title.length > 200) throw invalid('title must be 200 characters or fewer.');
  return title;
};

const sortByDue = (rows) =>
  [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    if (!a.dueAt && !b.dueAt) return a.createdAt < b.createdAt ? 1 : -1;
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return a.dueAt < b.dueAt ? -1 : 1;
  });

/** @param {{ status?: 'open'|'done'|'all' }} options */
export const listTasks = ({ status = 'open' } = {}) => {
  const rows = load();
  const filtered = status === 'all' ? rows : rows.filter((task) => task.status === (status === 'done' ? 'done' : 'open'));
  return sortByDue(filtered);
};

export const getTask = (id) => load().find((task) => task.id === id) ?? null;

export const createTask = ({ title, dueAt = null, relatedMailId = null, source = 'manual' }, createdBy = 'demo-user') => {
  const task = {
    id: newId('task'),
    title: normaliseTitle(title),
    dueAt: normaliseDue(dueAt),
    status: 'open',
    source: TASK_SOURCES.includes(source) ? source : 'manual',
    relatedMailId: relatedMailId ? String(relatedMailId) : null,
    createdAt: new Date().toISOString(),
    createdBy,
  };
  load().push(task);
  persist();
  return task;
};

export const updateTask = (id, { status, title, dueAt } = {}) => {
  const task = getTask(id);
  if (!task) return null;
  if (status !== undefined) {
    if (!TASK_STATUSES.includes(status)) throw invalid('status must be "open" or "done".');
    task.status = status;
    task.completedAt = status === 'done' ? new Date().toISOString() : null;
  }
  if (title !== undefined) task.title = normaliseTitle(title);
  if (dueAt !== undefined) task.dueAt = normaliseDue(dueAt);
  task.updatedAt = new Date().toISOString();
  persist();
  return task;
};

export const deleteTask = (id) => {
  const rows = load();
  const index = rows.findIndex((task) => task.id === id);
  if (index < 0) return false;
  rows.splice(index, 1);
  persist();
  return true;
};

/**
 * Open tasks due on a day (default: the reference date) plus everything
 * overdue before it. The briefing and the calendar answer both use this.
 */
export const tasksDue = ({ day = toIsoDate(now()), includeOverdue = true } = {}) => {
  const open = listTasks({ status: 'open' });
  const dueToday = open.filter((task) => task.dueAt && task.dueAt.slice(0, 10) === day);
  const overdue = includeOverdue
    ? open.filter((task) => task.dueAt && task.dueAt.slice(0, 10) < day)
    : [];
  return { day, dueToday, overdue, undated: open.filter((task) => !task.dueAt) };
};

/** Test hook: back to the seed, and clear the file so the next run starts clean. */
export const resetTasks = () => {
  tasks = seed();
  try {
    if (existsSync(STORE_PATH)) writeFileSync(STORE_PATH, JSON.stringify(tasks, null, 2));
  } catch {
    /* ignore */
  }
};

export const taskStorePath = () => STORE_PATH;
