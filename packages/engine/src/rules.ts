import { ALL_DIGITS_MASK, bit, CELLS, PEERS } from './codec';

/**
 * Client-safe rule helpers. This module deliberately imports nothing that can
 * solve a puzzle; the web app only needs to highlight rule conflicts.
 */

/** Cells whose value repeats in a row, column or box. */
export function conflictingCells(values: ArrayLike<number>): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < CELLS; i++) {
    const v = values[i];
    if (!v) continue;
    for (const p of PEERS[i]!) {
      if (values[p] === v) {
        out.add(i);
        out.add(p);
      }
    }
  }
  return out;
}

/** True if no peer of `cell` already holds `digit`. */
export function isConsistentPlacement(values: ArrayLike<number>, cell: number, digit: number): boolean {
  for (const p of PEERS[cell]!) if (values[p] === digit) return false;
  return true;
}

/** Digits still possible for `cell` given the filled cells (9-bit mask). */
export function candidateMask(values: ArrayLike<number>, cell: number): number {
  if (values[cell]) return 0;
  let used = 0;
  for (const p of PEERS[cell]!) if (values[p]) used |= bit(values[p]!);
  return ALL_DIGITS_MASK & ~used;
}

export function isFilled(values: ArrayLike<number>): boolean {
  for (let i = 0; i < CELLS; i++) if (!values[i]) return false;
  return true;
}

/** Same row, column or box as `cell` (used for UI highlighting). */
export function isPeer(a: number, b: number): boolean {
  return a !== b && PEERS[a]!.includes(b);
}
