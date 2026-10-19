import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { answerQuestion } from '../src/agent/orchestrator.js';
import { resolveAccess } from '../src/security/roles.js';
import { INTENTS } from '../src/agent/nlu.js';

const engineer = resolveAccess('engineer', 'eng-1');
const viewer = resolveAccess('viewer', 'view-1');

describe('Document questions end to end', () => {
  test('a procedure question routes to documents.search and answers with cited passages', async () => {
    const result = await answerQuestion({
      question: 'What is the escalation procedure for a paint defect?',
      access: engineer,
    });
    assert.equal(result.interpretation.intent, INTENTS.DOCUMENT_QUESTION);
    assert.ok(result.answer.bullets.length > 0, 'passages render as bullets');
    assert.ok(
      result.sources.some((s) => s.label === 'Documents'),
      'the answer cites the Documents source',
    );
  });

  test('a German procedure question is understood and answered in German', async () => {
    const result = await answerQuestion({
      question: 'Wie ist die Vorgehensweise bei einem Lackfehler?',
      access: engineer,
    });
    assert.equal(result.interpretation.intent, INTENTS.DOCUMENT_QUESTION);
    assert.equal(result.language, 'de');
  });

  test('numeric production questions are NOT captured by the document intent', async () => {
    const result = await answerQuestion({
      question: 'What problems did we have this week?',
      access: engineer,
    });
    assert.notEqual(result.interpretation.intent, INTENTS.DOCUMENT_QUESTION);
  });

  test('a viewer asking about cost documents gets no management-only passage', async () => {
    const result = await answerQuestion({
      question: 'What does the policy say about rework cost?',
      access: viewer,
    });
    // Either routed to documents and filtered, or routed elsewhere; in no case
    // may a Documents citation expose the management-only cost document.
    const docPayload = result.structured?.documents ?? null;
    if (docPayload?.passages) {
      assert.ok(docPayload.passages.every((p) => p.documentId !== 'ref-kostenstelle'));
    }
  });
});
