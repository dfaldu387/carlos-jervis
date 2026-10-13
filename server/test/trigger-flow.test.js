import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Isolate the stores so Power Automate stays in mock mode (not configured).
process.env.JERVIS_INTEGRATIONS_FILE = join(tmpdir(), `jervis-tf-int-${randomUUID()}.json`);
process.env.JERVIS_TASKS_FILE = join(tmpdir(), `jervis-tf-tasks-${randomUUID()}.json`);
process.env.JERVIS_DASHBOARDS_FILE = join(tmpdir(), `jervis-tf-dash-${randomUUID()}.json`);

const { parseQuestion } = await import('../src/agent/nlu.js');
const { answerQuestion } = await import('../src/agent/orchestrator.js');
const { resolveAccess } = await import('../src/security/roles.js');
const { setAutomateFetch } = await import('../src/automate/index.js');
const { resetStore } = await import('../src/integrations/store.js');

const manager = resolveAccess('manager', 'u-mgr');
const viewer = resolveAccess('viewer', 'u-view');

/** A fetch that fails the test if the proposal path ever reaches the network. */
let fetchCalls = 0;
const guardFetch = () => {
  fetchCalls = 0;
  setAutomateFetch(async () => {
    fetchCalls += 1;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
  });
};

describe('TRIGGER_FLOW chat intent', () => {
  before(() => guardFetch());
  after(() => setAutomateFetch(null));
  beforeEach(() => {
    resetStore();
    fetchCalls = 0;
  });

  test('English: "escalate this quality issue" proposes the escalation flow', async () => {
    const result = await answerQuestion({ question: 'escalate this quality issue because of E-7781', access: manager });
    assert.equal(result.interpretation.intent, 'trigger_flow');
    assert.equal(result.language, 'en');
    assert.ok(result.automation, 'a proposal is attached');
    assert.equal(result.automation.status, 'proposed');
    assert.equal(result.automation.flow, 'escalate-quality-issue');
    assert.equal(result.automation.mode, 'mock');
    assert.equal(result.automation.payload.errorCode, 'E-7781', 'the parsed error code rides along as payload');
    assert.match(result.answer.headline, /Ready to start/);
    assert.ok(result.answer.narrative.some((line) => /confirm/i.test(line)), 'it says nothing runs until confirmed');
    assert.equal(fetchCalls, 0, 'proposing a flow never calls out');
  });

  test('German: "eskaliere dieses Qualitätsproblem" proposes it in German', async () => {
    const result = await answerQuestion({ question: 'eskaliere dieses Qualitätsproblem', access: manager });
    assert.equal(result.interpretation.intent, 'trigger_flow');
    assert.equal(result.language, 'de');
    assert.equal(result.automation.status, 'proposed');
    assert.equal(result.automation.flow, 'escalate-quality-issue');
    assert.match(result.answer.headline, /Bereit zum Start/);
    assert.ok(result.answer.narrative.some((line) => /bestätigen/i.test(line)), 'the confirmation note is German');
    assert.ok(!result.answer.narrative.some((line) => /Nothing runs until/.test(line)), 'no English leaks in');
    assert.equal(fetchCalls, 0);
  });

  test('German maintenance and report requests map to the right flows', async () => {
    const maint = await answerQuestion({ question: 'starte die Wartungsanfrage', access: manager });
    assert.equal(maint.interpretation.intent, 'trigger_flow');
    assert.equal(maint.automation.flow, 'request-maintenance-visit');

    const report = await answerQuestion({ question: 'verteile den Tagesbericht', access: manager });
    assert.equal(report.interpretation.intent, 'trigger_flow');
    assert.equal(report.automation.flow, 'daily-report-distribution');
  });

  test('English maintenance and report requests map to the right flows', async () => {
    const maint = await answerQuestion({ question: 'start the maintenance visit request', access: manager });
    assert.equal(maint.automation.flow, 'request-maintenance-visit');
    const report = await answerQuestion({ question: 'send the daily report', access: manager });
    assert.equal(report.automation.flow, 'daily-report-distribution');
  });

  test('an ambiguous request returns automation: null and lists the flows', async () => {
    const result = await answerQuestion({ question: 'start a flow', access: manager });
    assert.equal(result.interpretation.intent, 'trigger_flow');
    assert.equal(result.automation, null, 'no flow matched');
    assert.match(result.answer.headline, /Which flow/);
    const listing = result.answer.narrative.join(' ');
    for (const label of ['Escalate a quality issue', 'Request a maintenance visit', 'Distribute the daily report']) {
      assert.ok(listing.includes(label), `the ambiguous answer lists "${label}"`);
    }
    assert.equal(fetchCalls, 0);
  });

  test('the German ambiguous answer is German', async () => {
    const result = await answerQuestion({ question: 'starte einen Ablauf', access: manager });
    assert.equal(result.interpretation.intent, 'trigger_flow');
    assert.equal(result.automation, null);
    assert.match(result.answer.headline, /Welchen Ablauf/);
  });

  test('follow-ups are flow phrases that parse back to a trigger', async () => {
    const result = await answerQuestion({ question: 'escalate this quality issue', access: manager });
    assert.ok(result.answer.followUps.length >= 1);
    // The proposed flow is not suggested back to itself.
    assert.ok(!result.answer.followUps.includes('Escalate a quality issue'));
    for (const phrase of result.answer.followUps) {
      const back = parseQuestion(phrase);
      assert.equal(back.intent, 'trigger_flow', `"${phrase}" parses back to trigger_flow`);
      assert.ok(back.entities.flow, `"${phrase}" names a flow`);
    }
  });

  test('a viewer cannot trigger a flow: the tool is withheld, nothing is proposed', async () => {
    const result = await answerQuestion({ question: 'escalate this quality issue', access: viewer });
    assert.equal(result.interpretation.intent, 'trigger_flow');
    assert.ok(!result.automation, 'no proposal for a role without automate:run');
    assert.ok(result.withheld.some((entry) => entry.tool === 'automate.trigger' && entry.permission === 'automate:run'));
    assert.equal(fetchCalls, 0);
  });
});
