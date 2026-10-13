import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpoken } from '../src/agent/synthesizer.js';
import { answerQuestion } from '../src/agent/orchestrator.js';
import { resolveAccess } from '../src/security/roles.js';

const manager = resolveAccess('manager');

describe('read-aloud answers', () => {
  test('keeps the figures when dropping the repeated period', () => {
    const spoken = buildSpoken({
      headline: '52 problems recorded on Friday 2026-10-02',
      narrative: [
        'On Friday 2026-10-02 there were 52 issue events affecting 45 vehicles. 16 vehicles were removed from the line.',
      ],
      bullets: [],
    });

    assert.match(spoken, /52 issue events/, 'the issue count must survive the trim');
    assert.match(spoken, /45 vehicles/, 'the vehicle count must survive the trim');
    assert.match(spoken, /There were 52/, 'the trimmed sentence should be recapitalised');
    assert.equal(
      (spoken.match(/2026-10-02/g) ?? []).length,
      1,
      'the date should be said once, not twice',
    );
  });

  test('drops the repeated period for a shift answer too', () => {
    const spoken = buildSpoken({
      headline: '19 issues recorded on Wednesday 2026-10-07, Early shift (06:00-14:00)',
      narrative: [
        'On Wednesday 2026-10-07, Early shift (06:00-14:00) the production issue history holds 19 issue events, affecting 18 vehicles.',
      ],
      bullets: [],
    });

    assert.match(spoken, /19 issue events/);
    assert.match(spoken, /18 vehicles/);
    assert.ok(!/Early shift \(06:00-14:00\) the production/.test(spoken), 'shift should not repeat');
  });

  test('leaves a paragraph that does not open with the period alone', () => {
    const spoken = buildSpoken({
      headline: '31 vehicles reworked on Wednesday 2026-10-07',
      narrative: ['31 vehicles went through rework on Wednesday 2026-10-07, of which 12 were removed.'],
      bullets: [],
    });
    assert.match(spoken, /31 vehicles went through rework/);
  });

  test('expands written shorthand for the ear', () => {
    const spoken = buildSpoken({
      headline: 'Rework booked',
      narrative: ['Booked time was 64 h 43 min, mostly against E-5007 at CP-22 under CC-4230.'],
      bullets: [],
    });

    assert.match(spoken, /64 hours 43 minutes/);
    assert.match(spoken, /E 5 0 0 7/, 'error codes read digit by digit');
    assert.match(spoken, /checkpoint 2 2/);
    assert.match(spoken, /cost center 4 2 3 0/);
    assert.ok(!/\bh\b|\bmin\b/.test(spoken), 'no bare unit abbreviations should remain');
  });

  test('says one hour and one minute in the singular', () => {
    const spoken = buildSpoken({
      headline: 'Downtime',
      narrative: ['Total was 1 h 1 min.'],
      bullets: [],
    });
    assert.match(spoken, /1 hour 1 minute/);
  });

  test('skips a warning the narrative already stated', () => {
    const spoken = buildSpoken({
      headline: '52 problems recorded',
      narrative: ['There were 52 issue events and 16 vehicles were removed from the line.'],
      bullets: [{ text: '16 vehicles removed from the line', tone: 'warning' }],
    });
    assert.equal((spoken.match(/16 vehicles/g) ?? []).length, 1, 'the figure should be said once');
  });

  test('keeps a warning the narrative did not state', () => {
    const spoken = buildSpoken({
      headline: '52 problems recorded',
      narrative: ['There were 52 issue events.'],
      bullets: [{ text: '7 vehicles removed from the line', tone: 'warning' }],
    });
    assert.match(spoken, /7 vehicles removed/);
  });

  test('every answer carries a spoken form for the voice loop', async () => {
    for (const question of [
      'What problems did we have on Friday?',
      'How many vehicles were reworked yesterday?',
      'hello',
      'zzzz',
    ]) {
      const result = await answerQuestion({ question, access: manager });
      assert.ok(result.answer.spoken, `"${question}" should have a spoken form`);
      assert.ok(result.answer.spoken.length < 700, 'spoken answers stay short enough to listen to');
    }
  });
});
