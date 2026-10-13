/**
 * Seeded pseudo-random number generator (sfc32, seeded through splitmix32).
 *
 * Determinism matters: the same seed must always yield the same puzzle so that
 * puzzles can be reproduced and verified after a match. Because the engine is
 * open source, a seed is as sensitive as the solution itself and must never be
 * sent to a client before the match is over.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Fisher-Yates shuffle in place; returns the same array. */
  shuffle<T>(items: T[]): T[];
  /** Random element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('Seed must be an unsigned 32-bit integer');
  }
  const init = splitmix32(seed);
  let a = init();
  let b = init();
  let c = init();
  let d = init();

  const nextU32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t;
  };
  // Discard the first outputs to decorrelate nearby seeds.
  for (let i = 0; i < 12; i++) nextU32();

  const rng: Rng = {
    next: () => nextU32() / 4294967296,
    int: (maxExclusive) => Math.floor(rng.next() * maxExclusive),
    shuffle: (items) => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const tmp = items[i]!;
        items[i] = items[j]!;
        items[j] = tmp;
      }
      return items;
    },
    pick: (items) => {
      if (items.length === 0) throw new Error('Cannot pick from an empty array');
      return items[rng.int(items.length)]!;
    },
  };
  return rng;
}
