import { createHash } from 'node:crypto';
import { config } from '../config.js';

/**
 * Embeddings.
 *
 * The default provider is deterministic and offline: it hashes word n-grams
 * into a fixed-dimension vector and L2-normalises it, so cosine similarity is
 * meaningful and no document text ever leaves the machine. Quality is rough
 * compared with a real embedding model, but it proves the whole pipeline — and
 * the ACL filter — end to end with zero configuration.
 *
 * `getEmbedder()` is the seam: point `JERVIS_EMBEDDING_PROVIDER` at a real
 * provider (self-hosted multilingual-e5, Azure OpenAI) later without touching
 * any caller. Only the deterministic provider is implemented today.
 */

const DIMENSIONS = 256;

// Lowercase, strip punctuation, split on whitespace. Works the same for German
// and English because it never assumes a language-specific stemmer.
export const tokenize = (text) =>
  String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

const bucketFor = (token) => {
  const hash = createHash('md5').update(token).digest();
  // First 4 bytes → an unsigned int → a bucket in [0, DIMENSIONS).
  return hash.readUInt32BE(0) % DIMENSIONS;
};

export class DeterministicEmbedder {
  constructor({ dimensions = DIMENSIONS } = {}) {
    this.dimensions = dimensions;
    this.name = 'deterministic';
  }

  embed(text) {
    const vector = new Array(this.dimensions).fill(0);
    const tokens = tokenize(text);
    for (const token of tokens) {
      vector[bucketFor(token) % this.dimensions] += 1;
      // One bigram feature per adjacent pair adds a little word-order signal.
    }
    for (let i = 0; i < tokens.length - 1; i += 1) {
      vector[bucketFor(`${tokens[i]}_${tokens[i + 1]}`) % this.dimensions] += 0.5;
    }
    return l2normalize(vector);
  }
}

export const l2normalize = (vector) => {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
};

export const cosineSimilarity = (a, b) => {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) dot += a[i] * b[i];
  return dot; // both inputs are expected L2-normalised
};

let embedder = null;

export const getEmbedder = () => {
  if (embedder) return embedder;
  const provider = config.rag?.embeddingProvider ?? 'deterministic';
  switch (provider) {
    // case 'azure-openai': embedder = new AzureOpenAIEmbedder(...); break;
    // case 'self-hosted':  embedder = new HttpEmbedder(...); break;
    case 'deterministic':
    default:
      embedder = new DeterministicEmbedder();
      break;
  }
  return embedder;
};

export const resetEmbedder = () => {
  embedder = null;
};
