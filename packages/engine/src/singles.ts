import { BOX_OF, bit, CELLS, COL_OF, MASK_DIGITS, POPCOUNT, ROW_OF, UNITS } from './codec';
import { candidateMask } from './rules';

export interface Single {
  cell: number;
  digit: number;
  kind: 'naked' | 'hidden';
}

/**
 * Every placement deducible right now with the two techniques people use
 * most: naked singles (one candidate left in a cell) and hidden singles (a
 * digit with one possible cell in a row, column or box). Server-only: bots use
 * it to play like humans, anti-cheat uses it to judge whether a fill was
 * deducible from the player's own board.
 */
export function findSingles(values: ArrayLike<number>): Single[] {
  const masks = new Uint16Array(CELLS);
  for (let i = 0; i < CELLS; i++) masks[i] = candidateMask(values, i);

  const found = new Map<number, Single>();
  for (let i = 0; i < CELLS; i++) {
    if (!values[i] && POPCOUNT[masks[i]!] === 1) {
      found.set(i, { cell: i, digit: MASK_DIGITS[masks[i]!]![0]!, kind: 'naked' });
    }
  }
  for (const unit of UNITS) {
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      let where = -1;
      let n = 0;
      for (const c of unit) {
        if (values[c] === d) {
          n = -1;
          break;
        }
        if (!values[c] && masks[c]! & b) {
          where = c;
          n++;
        }
      }
      if (n === 1 && !found.has(where)) found.set(where, { cell: where, digit: d, kind: 'hidden' });
    }
  }
  return [...found.values()];
}

/** True if placing `digit` at `cell` is a naked or hidden single on this board. */
export function isSinglePlacement(values: ArrayLike<number>, cell: number, digit: number): boolean {
  if (values[cell]) return false;
  const mask = candidateMask(values, cell);
  if (!(mask & bit(digit))) return false;
  if (POPCOUNT[mask] === 1) return true;
  const b = bit(digit);
  for (const unit of [UNITS[ROW_OF[cell]!]!, UNITS[9 + COL_OF[cell]!]!, UNITS[18 + BOX_OF[cell]!]!]) {
    let others = 0;
    for (const c of unit) if (c !== cell && !values[c] && candidateMask(values, c) & b) others++;
    if (others === 0) return true;
  }
  return false;
}
