import { addDays, now } from '../utils/dates.js';

/**
 * Turns "remind me to call the supplier tomorrow at 9" into a task title and
 * a due timestamp, relative to the configured reference date. English and
 * German phrasings are handled side by side; anything not recognised leaves
 * dueAt null rather than guessing a time.
 */

const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAYS_DE = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];

/** Next occurrence of a weekday strictly after `from` (a reminder is never in the past). */
const nextWeekday = (name, from) => {
  const target = WEEKDAYS_EN.indexOf(name) >= 0 ? WEEKDAYS_EN.indexOf(name) : WEEKDAYS_DE.indexOf(name);
  if (target < 0) return null;
  let cursor = addDays(from, 1);
  for (let i = 0; i < 8; i += 1) {
    if (cursor.getUTCDay() === target) return cursor;
    cursor = addDays(cursor, 1);
  }
  return null;
};

const setTime = (date, hour, minute = 0) => {
  const copy = new Date(date.getTime());
  copy.setUTCHours(hour, minute, 0, 0);
  return copy;
};

/** "9", "9:30", "14:00", "9 am", "3 pm", "9 uhr", "9.30 uhr" -> { hour, minute } */
const parseClock = (text) => {
  const match = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|uhr|h)?\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const suffix = match[3];
  if (hour > 23 || minute > 59) return null;
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  return { hour, minute, raw: match[0] };
};

const TRIGGERS = [
  /^(?:please\s+)?remind me (?:to|that|about|of)\s+/i,
  /^(?:please\s+)?remind me\s+/i,
  /^(?:please\s+)?(?:set|create|add) (?:a |an )?(?:reminder|task|todo|to-do)(?: to| for| about|:)?\s+/i,
  /^(?:please\s+)?reminder(?: to| for|:)?\s+/i,
  /^(?:bitte\s+)?erinnere mich (?:bitte\s+)?(?:daran,?\s*)?(?:an\s+)?/i,
  /^(?:bitte\s+)?erinner(?:e|ung)(?: mich)?(?: daran,?)?\s+/i,
  /^(?:bitte\s+)?(?:lege|leg|erstelle|erstell) (?:eine |einen )?(?:erinnerung|aufgabe)(?: an)?(?: für|:)?\s+/i,
];

export const isReminderRequest = (text) => TRIGGERS.some((pattern) => pattern.test(String(text ?? '').trim()));

/**
 * @param {string} question
 * @returns {{ title: string, dueAt: string|null, expression: string|null } | null}
 */
export const parseReminder = (question) => {
  const original = String(question ?? '').trim().replace(/[.!?]+$/, '');
  let rest = original;
  let matched = false;
  for (const pattern of TRIGGERS) {
    if (pattern.test(rest)) {
      rest = rest.replace(pattern, '');
      matched = true;
      break;
    }
  }
  if (!matched) return null;

  const base = now();
  let day = null;
  let clock = null;
  let dueAt = null;
  const expressions = [];
  let text = rest;

  const take = (pattern, handler) => {
    const match = text.match(pattern);
    if (!match) return;
    handler(match);
    expressions.push(match[0].trim());
    text = text.replace(match[0], ' ');
  };

  // Relative offsets first: "in 2 hours", "in 30 minutes", "in 3 days", "in 2 stunden".
  take(/\bin (\d{1,3}) ?(hours?|hrs?|h|stunden?|std\.?)\b/i, (match) => {
    dueAt = new Date(base.getTime() + Number(match[1]) * 3600000);
  });
  take(/\bin (\d{1,3}) ?(minutes?|mins?|minuten?|min\.?)\b/i, (match) => {
    dueAt = new Date(base.getTime() + Number(match[1]) * 60000);
  });
  take(/\bin (\d{1,2}) ?(days?|tagen?)\b/i, (match) => {
    day = addDays(base, Number(match[1]));
  });
  take(/\b(?:in|next|nächste|nächster|naechste) (?:a |einer )?(week|woche)\b/i, () => {
    day = addDays(base, 7);
  });

  // Named days.
  take(/\b(?:the )?day after tomorrow\b|\bübermorgen\b|\buebermorgen\b/i, () => {
    day = addDays(base, 2);
  });
  if (!day) {
    take(/\btomorrow\b|\bmorgen\b/i, () => {
      day = addDays(base, 1);
    });
  }
  if (!day) {
    take(/\btoday\b|\bheute\b|\btonight\b|\bheute abend\b/i, () => {
      day = base;
    });
  }
  if (!day) {
    take(
      /\b(?:on |next |am |nächsten |naechsten )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i,
      (match) => {
        day = nextWeekday(match[1].toLowerCase(), base);
      },
    );
  }
  if (!day) {
    take(/\b(\d{4}-\d{2}-\d{2})\b/, (match) => {
      day = new Date(`${match[1]}T00:00:00Z`);
    });
  }

  // Clock time: "at 9", "at 9:30", "at 3 pm", "um 9", "um 9 uhr", "um 14:00 uhr".
  take(/\b(?:at|um|around|gegen)\s+(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|uhr|h)?)\b/i, (match) => {
    clock = parseClock(match[1].toLowerCase());
  });
  if (!clock) {
    take(/\b(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|uhr))\b/i, (match) => {
      clock = parseClock(match[1].toLowerCase());
    });
  }
  if (clock && !day && !dueAt) {
    // A bare time means today, or tomorrow when that time has already passed.
    const candidate = setTime(base, clock.hour, clock.minute);
    day = candidate.getTime() > base.getTime() ? base : addDays(base, 1);
  }
  if (day && !dueAt) {
    // A day without a time lands at the start of the early shift's office hour.
    dueAt = clock ? setTime(day, clock.hour, clock.minute) : setTime(day, 9, 0);
  }

  const title = text
    .replace(/\s+/g, ' ')
    .replace(/^[\s,:-]+|[\s,:-]+$/g, '')
    .replace(/^(?:daran|that|dass)\s*,?\s*/i, '')
    .replace(/^(?:to|zu)\s+/i, '')
    .trim();

  if (!title) return null;

  return {
    title: title.replace(/^./, (character) => character.toUpperCase()),
    dueAt: dueAt ? dueAt.toISOString() : null,
    expression: expressions.length ? expressions.join(' ') : null,
  };
};
