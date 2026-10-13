import { ALL_DIGITS_MASK, BOX_OF, CELLS, COL_OF, type Grid, MASK_DIGITS, POPCOUNT, ROW_OF } from './codec';
import type { Rng } from './prng';

/**
 * Bitmask backtracking solver with the "minimum remaining values" heuristic.
 * Fast enough to count solutions thousands of times while digging a puzzle.
 */
interface SearchState {
  cells: Uint8Array;
  rows: Uint16Array;
  cols: Uint16Array;
  boxes: Uint16Array;
  rng: Rng | undefined;
  first: Uint8Array | null;
}

function initState(grid: Grid, rng?: Rng): SearchState | null {
  const state: SearchState = {
    cells: grid.slice(),
    rows: new Uint16Array(9),
    cols: new Uint16Array(9),
    boxes: new Uint16Array(9),
    rng,
    first: null,
  };
  for (let i = 0; i < CELLS; i++) {
    const v = state.cells[i]!;
    if (v === 0) continue;
    if (v < 1 || v > 9) return null;
    const b = 1 << (v - 1);
    const r = ROW_OF[i]!;
    const c = COL_OF[i]!;
    const x = BOX_OF[i]!;
    // A duplicate given makes the grid unsolvable.
    if (state.rows[r]! & b || state.cols[c]! & b || state.boxes[x]! & b) return null;
    state.rows[r]! |= b;
    state.cols[c]! |= b;
    state.boxes[x]! |= b;
  }
  return state;
}

function search(s: SearchState, limit: number): number {
  let best = -1;
  let bestMask = 0;
  let bestCount = 10;
  for (let i = 0; i < CELLS; i++) {
    if (s.cells[i] !== 0) continue;
    const mask = ~(s.rows[ROW_OF[i]!]! | s.cols[COL_OF[i]!]! | s.boxes[BOX_OF[i]!]!) & ALL_DIGITS_MASK;
    const count = POPCOUNT[mask]!;
    if (count < bestCount) {
      best = i;
      bestMask = mask;
      bestCount = count;
      if (count <= 1) break;
    }
  }

  if (best === -1) {
    if (!s.first) s.first = s.cells.slice();
    return 1;
  }
  if (bestCount === 0) return 0;

  const digits = s.rng ? s.rng.shuffle([...MASK_DIGITS[bestMask]!]) : MASK_DIGITS[bestMask]!;
  const r = ROW_OF[best]!;
  const c = COL_OF[best]!;
  const x = BOX_OF[best]!;
  let total = 0;
  for (const d of digits) {
    const b = 1 << (d - 1);
    s.cells[best] = d;
    s.rows[r]! |= b;
    s.cols[c]! |= b;
    s.boxes[x]! |= b;
    total += search(s, limit - total);
    s.cells[best] = 0;
    s.rows[r]! &= ~b;
    s.cols[c]! &= ~b;
    s.boxes[x]! &= ~b;
    if (total >= limit) return total;
  }
  return total;
}

/** Counts solutions, stopping as soon as `limit` is reached. */
export function countSolutions(grid: Grid, limit = 2): number {
  const state = initState(grid);
  if (!state) return 0;
  return search(state, limit);
}

export function hasUniqueSolution(grid: Grid): boolean {
  return countSolutions(grid, 2) === 1;
}

/** Returns the first solution found, or null if the grid is unsolvable. */
export function solve(grid: Grid): Grid | null {
  const state = initState(grid);
  if (!state) return null;
  search(state, 1);
  return state.first;
}

/** Like `solve`, but explores candidates in random order (used to create full grids). */
export function solveRandom(grid: Grid, rng: Rng): Grid | null {
  const state = initState(grid, rng);
  if (!state) return null;
  search(state, 1);
  return state.first;
}

/** True when the grid is completely filled and satisfies every Sudoku rule. */
export function isSolvedGrid(grid: Grid): boolean {
  if (grid.length !== CELLS) return false;
  const rows = new Uint16Array(9);
  const cols = new Uint16Array(9);
  const boxes = new Uint16Array(9);
  for (let i = 0; i < CELLS; i++) {
    const v = grid[i]!;
    if (v < 1 || v > 9) return false;
    const b = 1 << (v - 1);
    if (rows[ROW_OF[i]!]! & b || cols[COL_OF[i]!]! & b || boxes[BOX_OF[i]!]! & b) return false;
    rows[ROW_OF[i]!]! |= b;
    cols[COL_OF[i]!]! |= b;
    boxes[BOX_OF[i]!]! |= b;
  }
  return true;
}
