import { randomUUID } from 'node:crypto';

export const newId = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;

/** Deterministic PRNG so the synthetic warehouse is identical on every boot. */
export const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const pick = (rng, list) => list[Math.floor(rng() * list.length)];

export const weightedPick = (rng, entries) => {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
};
