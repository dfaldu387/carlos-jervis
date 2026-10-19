/**
 * Test setup, loaded via `node --test --import=./test/_setup.js`.
 *
 * Pins the reference date so every relative-date question ("this week",
 * "yesterday", "on Friday") resolves against a fixed calendar instead of the
 * real clock. Without this, tests that assume a mid-to-late week day fail when
 * the suite happens to run on a Monday (week-to-date collapses to a single day,
 * so there is no multi-day trend and the label reads "am Montag" rather than
 * "für diese Woche").
 *
 * Saturday 2026-10-17 is late in the week, so week-to-date spans several days
 * and "yesterday" (Friday) and "on Friday" both fall on populated days of the
 * seeded 28-day history. A real JERVIS_REFERENCE_DATE in the environment wins.
 */
if (!process.env.JERVIS_REFERENCE_DATE) {
  process.env.JERVIS_REFERENCE_DATE = '2026-10-17';
}
