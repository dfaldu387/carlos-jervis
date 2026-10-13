import { config } from '../config.js';

export const SHIFTS = [
  { id: 'S1', name: 'Early shift', label: '06:00-14:00', startHour: 6, endHour: 14 },
  { id: 'S2', name: 'Late shift', label: '14:00-22:00', startHour: 14, endHour: 22 },
  { id: 'S3', name: 'Night shift', label: '22:00-06:00', startHour: 22, endHour: 6 },
];

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** The clock Jervis reasons against. Pinned by config so demos stay stable. */
export const now = () =>
  config.referenceDate ? new Date(`${config.referenceDate}T12:00:00Z`) : new Date();

export const toIsoDate = (date) => date.toISOString().slice(0, 10);

export const parseIsoDate = (value) => new Date(`${value}T00:00:00Z`);

export const addDays = (date, days) => {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};

export const weekdayName = (date) => WEEKDAYS[date.getUTCDay()];

export const weekdayIndex = (name) => WEEKDAYS.indexOf(name.toLowerCase());

/** Most recent occurrence of a weekday at or before `from`. */
export const lastWeekday = (name, from = now()) => {
  const target = weekdayIndex(name);
  if (target < 0) return null;
  let cursor = new Date(from.getTime());
  for (let i = 0; i < 8; i += 1) {
    if (cursor.getUTCDay() === target && cursor.getTime() <= from.getTime()) return cursor;
    cursor = addDays(cursor, -1);
  }
  return null;
};

export const shiftById = (id) =>
  SHIFTS.find((shift) => shift.id.toLowerCase() === String(id).toLowerCase()) ?? null;

/** Which shift a timestamp belongs to; the night shift wraps past midnight. */
export const shiftForTimestamp = (iso) => {
  const hour = new Date(iso).getUTCHours();
  if (hour >= 6 && hour < 14) return 'S1';
  if (hour >= 14 && hour < 22) return 'S2';
  return 'S3';
};

export const formatRange = (range) => {
  if (!range) return 'the selected period';
  if (range.label) return range.label;
  if (range.from === range.to) return range.from;
  return `${range.from} to ${range.to}`;
};

export const dayRange = (date) => ({ from: toIsoDate(date), to: toIsoDate(date) });

export const rangeDates = (range) => {
  const dates = [];
  let cursor = parseIsoDate(range.from);
  const end = parseIsoDate(range.to);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(toIsoDate(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
};
