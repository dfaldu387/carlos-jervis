import { tokenize } from './embeddings.js';

/**
 * Chunking.
 *
 * Fixed-size passages (~400 "tokens", here approximated by words) with ~15%
 * overlap and the document title prepended, so each passage is understandable
 * on its own and carries enough context to be embedded and quoted. Matches the
 * design in docs/RAG-DESIGN.md.
 */

const DEFAULT_SIZE = 400;
const DEFAULT_OVERLAP = 60;

export const chunkText = (text, { size = DEFAULT_SIZE, overlap = DEFAULT_OVERLAP } = {}) => {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const step = Math.max(1, size - overlap);
  const chunks = [];
  for (let start = 0; start < words.length; start += step) {
    const slice = words.slice(start, start + size);
    chunks.push(slice.join(' '));
    if (start + size >= words.length) break;
  }
  return chunks;
};

/**
 * Turn a document into indexable chunk records.
 * @param {{id,title,source,language,acl,content}} doc
 * @returns {Array<{id,documentId,title,source,language,acl,chunkIndex,content,terms}>}
 */
export const chunkDocument = (doc, options = {}) => {
  const passages = chunkText(doc.content, options);
  return passages.map((content, index) => {
    const withTitle = `${doc.title}\n\n${content}`;
    return {
      id: `${doc.id}#${index}`,
      documentId: doc.id,
      title: doc.title,
      source: doc.source,
      language: doc.language ?? null,
      acl: doc.acl ?? [],
      chunkIndex: index,
      content,
      // Precomputed token set for the keyword half of the hybrid score.
      terms: new Set(tokenize(withTitle)),
    };
  });
};
