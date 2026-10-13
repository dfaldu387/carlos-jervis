import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion } from '../src/agent/orchestrator.js';
import { resolveAccess } from '../src/security/roles.js';
import { getRepository } from '../src/data/index.js';

const manager = resolveAccess('manager');
const viewer = resolveAccess('viewer');

describe('agent pipeline', () => {
  test('answers the reference question with facts, sources and a trace', async () => {
    const result = await answerQuestion({
      question: 'What problems did we have on Friday?',
      access: manager,
    });

    assert.ok(result.answer.headline.length > 0);
    assert.ok(result.answer.narrative.length > 0);
    assert.ok(result.answer.metrics.length > 0, 'KPI tiles should be present');
    assert.ok(result.sources.length > 0, 'the answer must cite its sources');

    const stages = result.trace.map((step) => step.name);
    for (const required of ['understand', 'plan', 'retrieve', 'combine', 'answer']) {
      assert.ok(stages.includes(required), `trace should include the ${required} stage`);
    }
  });

  test('crosses more than one system for a daily summary', async () => {
    const result = await answerQuestion({
      question: 'Summarize what happened yesterday',
      access: manager,
    });
    const systems = new Set(result.sources.map((source) => source.source));
    assert.ok(systems.size >= 2, `expected multiple systems, got ${[...systems].join(',')}`);
  });

  test('every number in the answer comes from a retrieval step', async () => {
    const result = await answerQuestion({
      question: 'How many vehicles were reworked yesterday?',
      access: manager,
    });
    const repository = getRepository();
    const period = result.interpretation.period;
    const impact = await repository.vehicleImpact({ from: period.from, to: period.to });

    const tile = result.answer.metrics.find((item) => item.key === 'vehicles_reworked');
    assert.equal(tile.value, impact.reworked);
    assert.match(result.answer.narrative[0], new RegExp(String(impact.reworked)));
  });

  test('withholds cost data from roles without the finance permission', async () => {
    const asManager = await answerQuestion({
      question: 'What is the cost center impact this week?',
      access: manager,
    });
    const asViewer = await answerQuestion({
      question: 'What is the cost center impact this week?',
      access: viewer,
    });

    assert.ok(asManager.answer.metrics.some((item) => item.key === 'rework_cost'));
    assert.ok(!asViewer.answer.metrics.some((item) => item.key === 'rework_cost'));
    assert.ok(asViewer.answer.redactions.length > 0, 'the viewer must be told something was withheld');
  });

  test('conversational questions touch no data source', async () => {
    const result = await answerQuestion({ question: 'hello', access: manager });
    assert.equal(result.sources.length, 0);
    assert.ok(!result.trace.some((step) => step.name === 'retrieve'));
  });

  test('carries the previous period into a follow-up question', async () => {
    const first = await answerQuestion({
      question: 'What problems did we have on Friday?',
      access: manager,
    });
    const follow = await answerQuestion({
      question: 'and which models were affected?',
      access: manager,
      context: { lastTimeframe: first.interpretation.period },
    });
    assert.equal(follow.interpretation.period.from, first.interpretation.period.from);
    assert.equal(follow.interpretation.period.carriedOver, true);
  });

  test('an unrecognised question asks for more detail instead of guessing', async () => {
    const result = await answerQuestion({ question: 'zzzz', access: manager });
    assert.equal(result.interpretation.intent, 'unknown');
    assert.equal(result.sources.length, 0);
  });
});
