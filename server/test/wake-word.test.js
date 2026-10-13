import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

/**
 * The wake matcher runs in the browser, but its correctness is the difference
 * between a usable voice mode and one that fires on ordinary speech. The
 * matcher is pure, so the logic is mirrored here against the wake variants the
 * server publishes - keeping the two in step is what this guards.
 */
const buildWakeMatcher = (wake) => {
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = wake.variants.map(escape).join('|');
  const prefixes = wake.prefixes.map(escape).join('|');
  const pattern = new RegExp(`(?:\\b(?:${prefixes})\\b[\\s,]*)?\\b(?:${names})\\b[\\s,.:!?-]*`, 'i');

  return (text) => {
    const match = pattern.exec(text ?? '');
    if (!match) return null;
    return { remainder: text.slice(match.index + match[0].length).trim() };
  };
};

let wake;
let server;

describe('wake phrase detection', () => {
  test('publishes the voice configuration the browser needs', async () => {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;

    const response = await fetch(`http://127.0.0.1:${port}/api/voice/config`, {
      headers: { 'x-jervis-role': 'manager' },
    });
    const body = await response.json();
    server.close();

    assert.equal(response.status, 200);
    assert.ok(body.greeting.parts.length >= 3, 'the greeting parts table must be published');
    assert.equal(body.greeting.honorific, 'sir');
    assert.ok(body.greeting.prompt.length > 0, 'a prompt must follow the greeting');
    assert.match(body.greetingNow, /^Good (morning|afternoon|evening), sir!/);
    assert.ok(body.followUpPrompt.length > 0, 'a follow-up prompt must be configured');
    assert.ok(body.wake.variants.length >= 3, 'mis-hearings must be covered');
    assert.ok(body.timings.questionTimeoutMs > 0);

    wake = body.wake;
  });

  test('fires on the wake phrase and its common mis-hearings', () => {
    const matches = buildWakeMatcher(wake);
    for (const heard of [
      'hey jervis',
      'Hey Jervis',
      'hey jarvis',
      'hi jervis',
      'ok jervis',
      'okay jarvis',
      'hey, jervis',
      'hey service', // Chrome's most frequent substitution
      'jervis',
    ]) {
      assert.ok(matches(heard), `should wake on "${heard}"`);
    }
  });

  test('ignores speech that does not name the assistant', () => {
    const matches = buildWakeMatcher(wake);
    for (const heard of [
      'what problems did we have on friday',
      'hey can you check the line',
      'the early shift had six issues',
      'hello there',
    ]) {
      assert.equal(matches(heard), null, `should not wake on "${heard}"`);
    }
  });

  test('carries a question asked in the same breath', () => {
    const matches = buildWakeMatcher(wake);
    const result = matches('hey jervis what problems did we have on friday');
    assert.equal(result.remainder, 'what problems did we have on friday');

    const withComma = matches('jervis, how many vehicles were reworked yesterday?');
    assert.equal(withComma.remainder, 'how many vehicles were reworked yesterday?');
  });

  test('returns an empty remainder for a bare wake phrase', () => {
    const matches = buildWakeMatcher(wake);
    assert.equal(matches('hey jervis').remainder, '');
    assert.equal(matches('hey jervis.').remainder, '');
  });
});
