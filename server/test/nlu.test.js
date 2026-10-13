import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { INTENTS, parseQuestion, toFilter } from '../src/agent/nlu.js';

describe('question understanding', () => {
  test('recognises the reference question from the requirements', () => {
    const result = parseQuestion('What problems did we have on Friday?');
    assert.equal(result.intent, INTENTS.ISSUE_SUMMARY);
    assert.ok(result.entities.timeframe, 'a timeframe should be extracted');
    assert.equal(result.entities.timeframe.from, result.entities.timeframe.to);
  });

  test('maps the demonstrated production periods onto shifts', () => {
    assert.equal(parseQuestion('what happened between 06:00 and 14:00?').entities.shiftId, 'S1');
    assert.equal(parseQuestion('issues in the 14:00-22:00 period').entities.shiftId, 'S2');
    assert.equal(parseQuestion('night shift problems').entities.shiftId, 'S3');
  });

  test('extracts production dimensions', () => {
    const result = parseQuestion(
      'which parts were involved in E-4120 on Final Assembly 1 for the GLC?',
    );
    assert.equal(result.entities.errorCode, 'E-4120');
    assert.equal(result.entities.lineId, 'FA1');
    assert.equal(result.entities.modelId, 'X254');
    assert.equal(result.intent, INTENTS.PARTS_INVOLVED);
  });

  test('resolves relative periods', () => {
    const lastWeek = parseQuestion('what happened last week?');
    assert.ok(lastWeek.entities.timeframe.from < lastWeek.entities.timeframe.to);

    const lastSeven = parseQuestion('issues in the last 7 days');
    assert.match(lastSeven.entities.timeframe.label, /last 7 days/);

    const iso = parseQuestion('problems on 2026-10-02');
    assert.equal(iso.entities.timeframe.from, '2026-10-02');
  });

  test('assumes the current day when no period is named', () => {
    const result = parseQuestion('which error codes occurred?');
    assert.equal(result.resolvedTimeframe.assumed, true);
  });

  test('intent falls back to a dimension-scoped summary', () => {
    assert.equal(parseQuestion('Paint Line 2').intent, INTENTS.LINE_ISSUES);
    assert.equal(parseQuestion('E-1042').intent, INTENTS.ISSUE_SUMMARY);
    assert.equal(parseQuestion('xyzzy').intent, INTENTS.UNKNOWN);
  });

  test('builds a repository filter with only the named dimensions', () => {
    const filter = toFilter(parseQuestion('critical issues on Paint Line 2 yesterday'));
    assert.equal(filter.lineId, 'PL2');
    assert.equal(filter.severity, 'critical');
    assert.equal(filter.modelId, undefined);
    assert.equal(filter.from, filter.to);
  });
});
