/**
 * How Jervis opens.
 *
 * The first words on wake are a greeting for the time of day - "Good morning,
 * sir!" - followed by the prompt. Two callers need the same wording: the voice
 * loop, which speaks it in the browser the instant the wake phrase lands, and
 * the greeting intent, which answers a typed or spoken "hello". The parts
 * table below is published to the browser through /api/voice/config so neither
 * copy can drift from the other.
 *
 * `honorific` is a single config value rather than text baked into each
 * greeting: it is addressed to whoever is signed in, so a deployment with
 * mixed staff can set it per user, or empty it for "Good morning!".
 */

export const HONORIFIC = 'sir';

export const GREETING_PROMPT = 'What would you like to know?';

/**
 * Boundaries are local hours, applied from the hour given downwards. 22:00 to
 * 04:59 greets with "Good evening" rather than "Good morning": the night shift
 * runs 22:00-06:00, and someone three hours into it has not just woken up.
 */
export const GREETING_PARTS = [
  { id: 'morning', fromHour: 5, label: 'Good morning' },
  { id: 'afternoon', fromHour: 12, label: 'Good afternoon' },
  { id: 'evening', fromHour: 17, label: 'Good evening' },
  { id: 'night', fromHour: 22, label: 'Good evening' },
];

export const partOfDay = (hour) => {
  const ordered = [...GREETING_PARTS].sort((a, b) => b.fromHour - a.fromHour);
  // Hours before the first boundary belong to the night block that wrapped
  // past midnight.
  return (
    ordered.find((part) => hour >= part.fromHour) ??
    GREETING_PARTS.find((part) => part.id === 'night')
  );
};

/** "Good morning, sir!" */
export const greetingFor = (hour, honorific = HONORIFIC) => {
  const part = partOfDay(hour);
  return honorific ? `${part.label}, ${honorific}!` : `${part.label}!`;
};

/** "Good morning, sir! What would you like to know?" */
export const openingFor = (hour, honorific = HONORIFIC, prompt = GREETING_PROMPT) =>
  [greetingFor(hour, honorific), prompt].filter(Boolean).join(' ');

/**
 * The greeting follows the real wall clock, never the pinned demo date -
 * JERVIS_REFERENCE_DATE fixes which production day is being discussed, not
 * what time it is for the person asking.
 */
export const currentHour = () => new Date().getHours();
