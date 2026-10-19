import { getEmbedder, cosineSimilarity, tokenize } from './embeddings.js';
import { chunkDocument } from './chunk.js';

/**
 * In-memory vector store with an ACL filter.
 *
 * The prototype index lives in memory; the design (docs/RAG-DESIGN.md) moves it
 * to Postgres + pgvector behind this same interface once the database is live,
 * with the ACL filter pushed into the SQL `WHERE acl && user_groups` so a
 * passage the user may not read is never even scored. Here the ACL intersection
 * is applied before scoring for exactly that reason.
 *
 * Score is hybrid: cosine similarity on the embeddings plus a keyword-overlap
 * term, so an exact wording match still surfaces even when the rough offline
 * embedding is weak. Both are in [0, 1] and averaged.
 */
export class DocumentIndex {
  constructor({ embedder = getEmbedder() } = {}) {
    this.embedder = embedder;
    this.chunks = [];
  }

  /** Index one document (chunk → embed → store). */
  addDocument(doc) {
    for (const chunk of chunkDocument(doc)) {
      chunk.embedding = this.embedder.embed(`${chunk.title}\n\n${chunk.content}`);
      this.chunks.push(chunk);
    }
  }

  addDocuments(docs) {
    for (const doc of docs) this.addDocument(doc);
  }

  get size() {
    return this.chunks.length;
  }

  /**
   * Search the index.
   * @param {string} query
   * @param {{ userGroups?: string[], limit?: number }} opts
   * @returns {Array<{documentId,title,source,language,chunkIndex,content,score}>}
   */
  search(query, { userGroups = [], limit = 4 } = {}) {
    const groups = new Set(userGroups);
    const queryVector = this.embedder.embed(query);
    const queryTerms = new Set(tokenize(query));

    const scored = [];
    for (const chunk of this.chunks) {
      // ACL filter first: skip anything the user's groups do not grant.
      if (chunk.acl.length > 0 && !chunk.acl.some((group) => groups.has(group))) continue;

      const vectorScore = Math.max(0, cosineSimilarity(queryVector, chunk.embedding));
      const keywordScore = keywordOverlap(queryTerms, chunk.terms);
      const score = 0.5 * vectorScore + 0.5 * keywordScore;
      if (score <= 0) continue;
      scored.push({
        documentId: chunk.documentId,
        title: chunk.title,
        source: chunk.source,
        language: chunk.language,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}

// Fraction of query terms present in the chunk (recall of the query wording).
const keywordOverlap = (queryTerms, chunkTerms) => {
  if (queryTerms.size === 0) return 0;
  let hits = 0;
  for (const term of queryTerms) if (chunkTerms.has(term)) hits += 1;
  return hits / queryTerms.size;
};
