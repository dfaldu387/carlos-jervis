import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DeterministicEmbedder, tokenize, cosineSimilarity } from '../src/rag/embeddings.js';
import { chunkText, chunkDocument } from '../src/rag/chunk.js';
import { DocumentIndex } from '../src/rag/store.js';
import { getDocumentIndex, groupsForRole } from '../src/rag/corpus.js';
import { documentsSearch } from '../src/agent/tools/documents.js';

describe('RAG — embeddings', () => {
  const embedder = new DeterministicEmbedder();

  test('tokenize lowercases and strips punctuation, works on German', () => {
    assert.deepEqual(tokenize('Nacharbeit, Fehlercode E-4120!'), ['nacharbeit', 'fehlercode', 'e', '4120']);
  });

  test('embedding is deterministic and L2-normalised', () => {
    const a = embedder.embed('paint defect escalation procedure');
    const b = embedder.embed('paint defect escalation procedure');
    assert.deepEqual(a, b);
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    assert.ok(Math.abs(norm - 1) < 1e-9);
  });

  test('similar text scores higher than unrelated text', () => {
    const q = embedder.embed('how do I escalate a paint defect');
    const near = embedder.embed('escalation procedure for a paint defect at a checkpoint');
    const far = embedder.embed('the shift calendar and public holidays next year');
    assert.ok(cosineSimilarity(q, near) > cosineSimilarity(q, far));
  });
});

describe('RAG — chunking', () => {
  test('splits long text with overlap', () => {
    const words = Array.from({ length: 900 }, (_, i) => `w${i}`).join(' ');
    const chunks = chunkText(words, { size: 400, overlap: 60 });
    assert.ok(chunks.length >= 2);
    // Overlap: the end of chunk 0 reappears at the start of chunk 1.
    const firstWords = chunks[0].split(' ');
    const secondWords = chunks[1].split(' ');
    assert.equal(secondWords[0], firstWords[400 - 60]);
  });

  test('chunkDocument prepends the title into the term set', () => {
    const chunks = chunkDocument({ id: 'd1', title: 'Paint defects', source: 's', acl: ['all'], content: 'spray booth cleaning' });
    assert.equal(chunks[0].id, 'd1#0');
    assert.ok(chunks[0].terms.has('paint'));
    assert.ok(chunks[0].terms.has('booth'));
  });
});

describe('RAG — index and ACL', () => {
  test('search returns the most relevant document', () => {
    const index = new DocumentIndex();
    index.addDocuments([
      { id: 'a', title: 'Paint defect escalation', source: 's', acl: ['all'], content: 'escalate a paint defect to the paint shop supervisor' },
      { id: 'b', title: 'Canteen menu', source: 's', acl: ['all'], content: 'the canteen serves lunch from twelve' },
    ]);
    const [top] = index.search('how do I escalate a paint defect', { userGroups: ['all'], limit: 1 });
    assert.equal(top.documentId, 'a');
  });

  test('ACL filter hides passages the user’s groups do not grant', () => {
    const index = new DocumentIndex();
    index.addDocuments([
      { id: 'cost', title: 'Cost centres', source: 's', acl: ['management'], content: 'rework cost per minute by cost centre' },
    ]);
    assert.equal(index.search('rework cost', { userGroups: ['all'] }).length, 0);
    assert.equal(index.search('rework cost', { userGroups: ['all', 'management'] }).length, 1);
  });
});

describe('RAG — corpus role mapping', () => {
  test('groupsForRole widens with privilege', () => {
    assert.deepEqual(groupsForRole('viewer'), ['all']);
    assert.ok(groupsForRole('engineer').includes('engineering'));
    assert.ok(groupsForRole('manager').includes('management'));
  });

  test('the shared corpus index is built and non-empty', () => {
    assert.ok(getDocumentIndex().size > 0);
  });
});

describe('RAG — documents.search tool', () => {
  test('returns passages for a procedure question and cites a document', async () => {
    const result = await documentsSearch.run({
      interpretation: { question: 'what is the escalation procedure for a paint defect' },
      access: { role: 'engineer' },
      language: 'en',
    });
    assert.ok(result.data.passages.length > 0);
    assert.equal(result.citation.source, 'documents');
    assert.ok(result.data.passages[0].title.length > 0);
  });

  test('a viewer cannot retrieve the management-only cost document', async () => {
    const result = await documentsSearch.run({
      interpretation: { question: 'wie werden die Nacharbeitskosten berechnet' },
      access: { role: 'viewer' },
      language: 'de',
    });
    assert.ok(result.data.passages.every((p) => p.documentId !== 'ref-kostenstelle'));
  });
});
