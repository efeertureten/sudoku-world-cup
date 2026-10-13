/**
 * Grid representation shared by every module of the engine.
 *
 * A grid is a Uint8Array of length 81 in row-major order. 0 means "empty",
 * 1-9 are digits. On the wire and in the database a grid is an 81-character
 * string where '0' (or '.') marks an empty cell.
 */
export type Grid = Uint8Array;

export const CELLS = 81;
export const ALL_DIGITS_MASK = 0x1ff;

export const rowOf = (cell: number): number => (cell / 9) | 0;
export const colOf = (cell: number): number => cell % 9;
export const boxOf = (cell: number): number => ((rowOf(cell) / 3) | 0) * 3 + ((colOf(cell) / 3) | 0);

/** Precomputed lookups so hot loops never divide. */
export const ROW_OF = new Uint8Array(CELLS);
export const COL_OF = new Uint8Array(CELLS);
export const BOX_OF = new Uint8Array(CELLS);
for (let i = 0; i < CELLS; i++) {
  ROW_OF[i] = rowOf(i);
  COL_OF[i] = colOf(i);
  BOX_OF[i] = boxOf(i);
}

/** 27 units: rows 0-8, columns 9-17, boxes 18-26. Each unit lists its 9 cells. */
export const UNITS: readonly (readonly number[])[] = (() => {
  const units: number[][] = [];
  for (let r = 0; r < 9; r++) units.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) units.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
  for (let b = 0; b < 9; b++) {
    const r0 = ((b / 3) | 0) * 3;
    const c0 = (b % 3) * 3;
    const cells: number[] = [];
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) cells.push((r0 + dr) * 9 + c0 + dc);
    units.push(cells);
  }
  return units;
})();

/** The 20 cells that share a row, column or box with each cell. */
export const PEERS: readonly (readonly number[])[] = (() => {
  const peers: number[][] = [];
  for (let i = 0; i < CELLS; i++) {
    const set = new Set<number>();
    for (const unit of [UNITS[ROW_OF[i]!]!, UNITS[9 + COL_OF[i]!]!, UNITS[18 + BOX_OF[i]!]!]) {
      for (const c of unit) if (c !== i) set.add(c);
    }
    peers.push([...set].sort((a, b) => a - b));
  }
  return peers;
})();

/** Number of set bits for every 9-bit mask. */
export const POPCOUNT = (() => {
  const t = new Uint8Array(512);
  for (let i = 1; i < 512; i++) t[i] = t[i >> 1]! + (i & 1);
  return t;
})();

/** Digits contained in a 9-bit mask, ascending. Bit 0 is digit 1. */
export const MASK_DIGITS: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  for (let m = 0; m < 512; m++) {
    const digits: number[] = [];
    for (let d = 1; d <= 9; d++) if (m & (1 << (d - 1))) digits.push(d);
    out.push(digits);
  }
  return out;
})();

export const bit = (digit: number): number => 1 << (digit - 1);

export function emptyGrid(): Grid {
  return new Uint8Array(CELLS);
}

export function parseGrid(input: string): Grid {
  const s = input.trim();
  if (s.length !== CELLS) throw new Error(`Grid string must have ${CELLS} characters, got ${s.length}`);
  const grid = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 46 /* . */ || ch === 48 /* 0 */) continue;
    if (ch < 49 || ch > 57) throw new Error(`Invalid character '${s[i]}' at position ${i}`);
    grid[i] = ch - 48;
  }
  return grid;
}

export function serializeGrid(grid: Grid): string {
  let s = '';
  for (let i = 0; i < CELLS; i++) s += String(grid[i]);
  return s;
}

export function countGivens(grid: Grid): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (grid[i] !== 0) n++;
  return n;
}

export function isValidGridString(s: string): boolean {
  return /^[0-9.]{81}$/.test(s);
}

/** Pretty-printer for debugging and tests. */
export function formatGrid(grid: Grid): string {
  const lines: string[] = [];
  for (let r = 0; r < 9; r++) {
    if (r > 0 && r % 3 === 0) lines.push('------+-------+------');
    const row: string[] = [];
    for (let c = 0; c < 9; c++) {
      if (c > 0 && c % 3 === 0) row.push('|');
      const v = grid[r * 9 + c];
      row.push(v ? String(v) : '.');
    }
    lines.push(row.join(' '));
  }
  return lines.join('\n');
}
