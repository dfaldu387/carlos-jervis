import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  GREETING_PARTS,
  greetingFor,
  openingFor,
  partOfDay,
} from '../src/agent/greeting.js';
import { answerQuestion } from '../src/agent/orchestrator.js';
import { resolveAccess } from '../src/security/roles.js';

/**
 * The browser builds the spoken greeting from the published parts table, so
 * this mirrors that selection to keep the two in step - the same guard the
 * wake matcher has.
 */
const buildOpening = (parts, honorific, prompt, hour) => {
  const part =
    [...parts].sort((a, b) => b.fromHour - a.fromHour).find((entry) => hour >= entry.fromHour) ??
    parts.find((entry) => entry.id === 'night');
  return [honorific ? `${part.label}, ${honorific}!` : `${part.label}!`, prompt]
    .filter(Boolean)
    .join(' ');
};

describe('greeting', () => {
  test('opens with the time of day and the honorific', () => {
    assert.equal(greetingFor(9), 'Good morning, sir!');
    assert.equal(greetingFor(14), 'Good afternoon, sir!');
    assert.equal(greetingFor(19), 'Good evening, sir!');
  });

  test('covers every hour of the clock', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const part = partOfDay(hour);
      assert.ok(part, `hour ${hour} must resolve to a part of the day`);
      assert.match(greetingFor(hour), /^Good (morning|afternoon|evening), sir!$/);
    }
  });

  test('greets the night shift with "Good evening", not "Good morning"', () => {
    // 22:00-06:00 is a working shift; someone three hours into it has not just
    // woken up.
    assert.equal(greetingFor(23), 'Good evening, sir!');
    assert.equal(greetingFor(2), 'Good evening, sir!');
    assert.equal(greetingFor(4), 'Good evening, sir!');
    // 05:00 is the start of the morning block.
    assert.equal(greetingFor(5), 'Good morning, sir!');
  });

  test('switches at the documented boundaries', () => {
    assert.equal(greetingFor(11), 'Good morning, sir!');
    assert.equal(greetingFor(12), 'Good afternoon, sir!');
    assert.equal(greetingFor(16), 'Good afternoon, sir!');
    assert.equal(greetingFor(17), 'Good evening, sir!');
  });

  test('the honorific can be changed or dropped', () => {
    assert.equal(greetingFor(9, 'madam'), 'Good morning, madam!');
    assert.equal(greetingFor(9, ''), 'Good morning!');
  });

  test('the full opening leads with the greeting, then the prompt', () => {
    const opening = openingFor(9);
    assert.ok(opening.startsWith('Good morning, sir!'), 'the greeting comes first');
    assert.match(opening, /What would you like to know\?$/);
  });

  test('the browser and the server build the same opening', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      assert.equal(
        buildOpening(GREETING_PARTS, 'sir', 'What would you like to know?', hour),
        openingFor(hour),
        `hour ${hour} must match on both sides`,
      );
    }
  });

  test('a spoken or typed hello is answered with the same opening', async () => {
    const result = await answerQuestion({ question: 'hello', access: resolveAccess('manager') });
    assert.match(result.answer.headline, /^Good (morning|afternoon|evening), sir!$/);
    assert.match(result.answer.spoken, /^Good (morning|afternoon|evening), sir!/);
  });
});
