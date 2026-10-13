import {
  ALL_DIGITS_MASK,
  bit,
  CELLS,
  countGivens,
  type Grid,
  MASK_DIGITS,
  PEERS,
  POPCOUNT,
  UNITS,
} from './codec';

/**
 * Human-technique logical solver used to grade difficulty.
 *
 * The number of givens is a poor difficulty signal. What makes a puzzle hard
 * for a human is the hardest deduction it forces, so we solve it the way a
 * person would (simplest technique first) and record what was needed.
 */
export const TECHNIQUES = [
  'hidden_single',
  'naked_single',
  'locked_candidates',
  'naked_pair',
  'hidden_pair',
  'naked_triple',
  'hidden_triple',
  'x_wing',
] as const;
export type Technique = (typeof TECHNIQUES)[number];

export const TECHNIQUE_WEIGHT: Record<Technique, number> = {
  hidden_single: 1,
  naked_single: 1.5,
  locked_candidates: 4,
  naked_pair: 6,
  hidden_pair: 7.5,
  naked_triple: 8.5,
  hidden_triple: 10,
  x_wing: 14,
};

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface GradeResult {
  /** True when the implemented techniques solve the puzzle without guessing. */
  solvedByLogic: boolean;
  hardest: Technique | 'beyond_logic';
  difficulty: Difficulty;
  /** Sum of technique weights over all steps; useful for finer ordering inside a band. */
  score: number;
  steps: number;
  counts: Partial<Record<Technique, number>>;
  /** Cells in the order the logical solver placed them. */
  placementOrder: number[];
  /** Board state when the logical solver stopped (complete when solvedByLogic). */
  values: Grid;
}

class LogicBoard {
  readonly values: Uint8Array;
  readonly cand: Uint16Array;
  readonly order: number[] = [];
  remaining = 0;
  broken = false;

  constructor(grid: Grid) {
    this.values = grid.slice();
    this.cand = new Uint16Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      if (this.values[i] !== 0) continue;
      this.remaining++;
      let used = 0;
      for (const p of PEERS[i]!) if (this.values[p]) used |= bit(this.values[p]!);
      this.cand[i] = ALL_DIGITS_MASK & ~used;
      if (this.cand[i] === 0) this.broken = true;
    }
  }

  place(cell: number, digit: number): void {
    this.values[cell] = digit;
    this.cand[cell] = 0;
    this.remaining--;
    this.order.push(cell);
    const b = bit(digit);
    for (const p of PEERS[cell]!) {
      if (this.values[p] === 0 && this.cand[p]! & b) {
        this.cand[p]! &= ~b;
        if (this.cand[p] === 0) this.broken = true;
      }
    }
  }

  /** Removes `mask` from a cell's candidates; returns true if anything changed. */
  eliminate(cell: number, mask: number): boolean {
    if (this.values[cell] !== 0) return false;
    const before = this.cand[cell]!;
    const after = before & ~mask;
    if (after === before) return false;
    this.cand[cell] = after;
    if (after === 0) this.broken = true;
    return true;
  }
}

function nakedSingle(b: LogicBoard): boolean {
  for (let i = 0; i < CELLS; i++) {
    if (b.values[i] === 0 && POPCOUNT[b.cand[i]!] === 1) {
      b.place(i, MASK_DIGITS[b.cand[i]!]![0]!);
      return true;
    }
  }
  return false;
}

function hiddenSingle(b: LogicBoard): boolean {
  // Boxes first: that is how most people scan a grid.
  const unitOrder = [
    18, 19, 20, 21, 22, 23, 24, 25, 26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
  ];
  for (const u of unitOrder) {
    const unit = UNITS[u]!;
    for (let d = 1; d <= 9; d++) {
      const m = bit(d);
      let where = -1;
      let count = 0;
      for (const c of unit) {
        if (b.values[c] === d) {
          count = -1;
          break;
        }
        if (b.values[c] === 0 && b.cand[c]! & m) {
          where = c;
          count++;
        }
      }
      if (count === 1) {
        b.place(where, d);
        return true;
      }
    }
  }
  return false;
}

function lockedCandidates(b: LogicBoard): boolean {
  let progress = false;
  for (let d = 1; d <= 9; d++) {
    const m = bit(d);
    // Pointing: candidates of d inside a box confined to one row/column.
    for (let bx = 18; bx < 27; bx++) {
      const cells = UNITS[bx]!.filter((c) => b.values[c] === 0 && b.cand[c]! & m);
      if (cells.length < 2) continue;
      const rows = new Set(cells.map((c) => (c / 9) | 0));
      const cols = new Set(cells.map((c) => c % 9));
      if (rows.size === 1) {
        const r = [...rows][0]!;
        for (const c of UNITS[r]!) if (!UNITS[bx]!.includes(c) && b.eliminate(c, m)) progress = true;
      }
      if (cols.size === 1) {
        const col = [...cols][0]!;
        for (const c of UNITS[9 + col]!) if (!UNITS[bx]!.includes(c) && b.eliminate(c, m)) progress = true;
      }
      if (progress) return true;
    }
    // Claiming: candidates of d inside a row/column confined to one box.
    for (let u = 0; u < 18; u++) {
      const cells = UNITS[u]!.filter((c) => b.values[c] === 0 && b.cand[c]! & m);
      if (cells.length < 2) continue;
      const boxes = new Set(cells.map((c) => ((((c / 9) | 0) / 3) | 0) * 3 + (((c % 9) / 3) | 0)));
      if (boxes.size !== 1) continue;
      const bx = 18 + [...boxes][0]!;
      for (const c of UNITS[bx]!) if (!UNITS[u]!.includes(c) && b.eliminate(c, m)) progress = true;
      if (progress) return true;
    }
  }
  return progress;
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i <= items.length - (k - acc.length); i++) {
      acc.push(items[i]!);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

function nakedSubset(b: LogicBoard, k: number): boolean {
  for (const unit of UNITS) {
    const empties = unit.filter((c) => b.values[c] === 0);
    if (empties.length <= k) continue;
    const small = empties.filter((c) => POPCOUNT[b.cand[c]!]! >= 2 && POPCOUNT[b.cand[c]!]! <= k);
    for (const combo of combinations(small, k)) {
      let union = 0;
      for (const c of combo) union |= b.cand[c]!;
      if (POPCOUNT[union] !== k) continue;
      let progress = false;
      for (const c of empties) if (!combo.includes(c) && b.eliminate(c, union)) progress = true;
      if (progress) return true;
    }
  }
  return false;
}

function hiddenSubset(b: LogicBoard, k: number): boolean {
  for (const unit of UNITS) {
    const empties = unit.filter((c) => b.values[c] === 0);
    if (empties.length <= k) continue;
    const positions = new Map<number, number[]>();
    for (let d = 1; d <= 9; d++) {
      const cells = empties.filter((c) => b.cand[c]! & bit(d));
      if (cells.length >= 2 && cells.length <= k) positions.set(d, cells);
    }
    for (const digits of combinations([...positions.keys()], k)) {
      const cellSet = new Set<number>();
      for (const d of digits) for (const c of positions.get(d)!) cellSet.add(c);
      if (cellSet.size !== k) continue;
      let keep = 0;
      for (const d of digits) keep |= bit(d);
      let progress = false;
      for (const c of cellSet) if (b.eliminate(c, ALL_DIGITS_MASK & ~keep)) progress = true;
      if (progress) return true;
    }
  }
  return false;
}

function xWing(b: LogicBoard): boolean {
  for (let d = 1; d <= 9; d++) {
    const m = bit(d);
    for (const byRow of [true, false]) {
      const pairs = new Map<string, number[]>();
      for (let line = 0; line < 9; line++) {
        const idx: number[] = [];
        for (let k = 0; k < 9; k++) {
          const c = byRow ? line * 9 + k : k * 9 + line;
          if (b.values[c] === 0 && b.cand[c]! & m) idx.push(k);
        }
        if (idx.length === 2) {
          const key = idx.join(',');
          pairs.set(key, [...(pairs.get(key) ?? []), line]);
        }
      }
      for (const [key, lines] of pairs) {
        if (lines.length !== 2) continue;
        const [k1, k2] = key.split(',').map(Number) as [number, number];
        let progress = false;
        for (let other = 0; other < 9; other++) {
          if (lines.includes(other)) continue;
          for (const k of [k1, k2]) {
            const c = byRow ? other * 9 + k : k * 9 + other;
            if (b.eliminate(c, m)) progress = true;
          }
        }
        if (progress) return true;
      }
    }
  }
  return false;
}

const STRATEGIES: [Technique, (b: LogicBoard) => boolean][] = [
  ['hidden_single', hiddenSingle],
  ['naked_single', nakedSingle],
  ['locked_candidates', lockedCandidates],
  ['naked_pair', (b) => nakedSubset(b, 2)],
  ['hidden_pair', (b) => hiddenSubset(b, 2)],
  ['naked_triple', (b) => nakedSubset(b, 3)],
  ['hidden_triple', (b) => hiddenSubset(b, 3)],
  ['x_wing', xWing],
];

const RANK: Record<Technique, number> = Object.fromEntries(TECHNIQUES.map((t, i) => [t, i])) as Record<
  Technique,
  number
>;

export function classify(hardest: Technique | 'beyond_logic', givens: number): Difficulty {
  if (hardest === 'beyond_logic' || hardest === 'x_wing') return 'expert';
  if (RANK[hardest] >= RANK.naked_pair) return 'hard';
  if (hardest === 'locked_candidates') return 'medium';
  return givens >= 32 ? 'easy' : 'medium';
}

export function gradePuzzle(puzzle: Grid): GradeResult {
  const board = new LogicBoard(puzzle);
  const counts: Partial<Record<Technique, number>> = {};
  let hardest: Technique = 'hidden_single';
  let score = 0;
  let steps = 0;

  while (board.remaining > 0 && !board.broken) {
    let applied: Technique | null = null;
    for (const [name, fn] of STRATEGIES) {
      if (fn(board)) {
        applied = name;
        break;
      }
    }
    if (!applied) break;
    steps++;
    counts[applied] = (counts[applied] ?? 0) + 1;
    score += TECHNIQUE_WEIGHT[applied];
    if (RANK[applied] > RANK[hardest]) hardest = applied;
  }

  const solvedByLogic = board.remaining === 0 && !board.broken;
  const finalHardest = solvedByLogic ? hardest : 'beyond_logic';
  return {
    solvedByLogic,
    hardest: finalHardest,
    difficulty: classify(finalHardest, countGivens(puzzle)),
    score: Math.round(score * 10) / 10,
    steps,
    counts,
    placementOrder: board.order,
    values: board.values,
  };
}
