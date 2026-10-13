import { CELLS, countGivens, emptyGrid, type Grid } from './codec';
import { DIFFICULTIES, type Difficulty, type GradeResult, gradePuzzle } from './grader';
import { createRng, type Rng } from './prng';
import { countSolutions, solveRandom } from './solver';

/** Bump whenever the generation algorithm changes so stored seeds stay reproducible. */
export const GENERATOR_VERSION = 1;

export interface GeneratedPuzzle {
  seed: number;
  generatorVersion: number;
  givens: Grid;
  solution: Grid;
  givensCount: number;
  grade: GradeResult;
}

interface DigProfile {
  minGivens: [number, number];
  symmetricChance: number;
}

const PROFILES: Record<Difficulty, DigProfile> = {
  easy: { minGivens: [34, 38], symmetricChance: 0.8 },
  medium: { minGivens: [27, 31], symmetricChance: 0.8 },
  hard: { minGivens: [17, 17], symmetricChance: 0.6 },
  expert: { minGivens: [17, 17], symmetricChance: 0.4 },
};

/**
 * A complete valid grid. The three diagonal boxes do not constrain each
 * other, so they are filled with random permutations first and the solver
 * (exploring digits in random order) completes the rest.
 */
export function generateSolution(rng: Rng): Grid {
  const grid = emptyGrid();
  for (const box of [0, 4, 8]) {
    const digits = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const r0 = ((box / 3) | 0) * 3;
    const c0 = (box % 3) * 3;
    let k = 0;
    for (let dr = 0; dr < 3; dr++)
      for (let dc = 0; dc < 3; dc++) grid[(r0 + dr) * 9 + c0 + dc] = digits[k++]!;
  }
  const solved = solveRandom(grid, rng);
  if (!solved) throw new Error('Diagonal seeding produced an unsolvable grid (should be impossible)');
  return solved;
}

/**
 * Removes clues while the puzzle keeps exactly one solution. Uniqueness is
 * mandatory: the server validates moves against a single stored solution, so
 * a second valid solution would make correct play look like a mistake.
 */
export function digPuzzle(solution: Grid, rng: Rng, minGivens: number, symmetric: boolean): Grid {
  const puzzle = solution.slice();
  const order = rng.shuffle(Array.from({ length: CELLS }, (_, i) => i));
  let givens = CELLS;
  for (const cell of order) {
    if (givens <= minGivens) break;
    if (puzzle[cell] === 0) continue;
    const mirror = CELLS - 1 - cell;
    const paired = symmetric && mirror !== cell && puzzle[mirror] !== 0;
    if (paired && givens - 2 < minGivens) continue;
    const saved = puzzle[cell]!;
    const savedMirror = puzzle[mirror]!;
    puzzle[cell] = 0;
    if (paired) puzzle[mirror] = 0;
    if (countSolutions(puzzle, 2) === 1) {
      givens -= paired ? 2 : 1;
    } else {
      puzzle[cell] = saved;
      if (paired) puzzle[mirror] = savedMirror;
    }
  }
  return puzzle;
}

const RANK: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2, expert: 3 };

/**
 * Deterministically generates a puzzle for `difficulty` from `seed`.
 * Retries with the same RNG stream until the grade matches; if it never does
 * within `maxAttempts`, the closest grade found is returned.
 */
export function generatePuzzle(seed: number, difficulty: Difficulty, maxAttempts = 400): GeneratedPuzzle {
  if (!DIFFICULTIES.includes(difficulty)) throw new Error(`Unknown difficulty: ${difficulty}`);
  const rng = createRng(seed);
  const profile = PROFILES[difficulty];
  let best: GeneratedPuzzle | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const solution = generateSolution(rng);
    const [lo, hi] = profile.minGivens;
    const minGivens = lo + rng.int(hi - lo + 1);
    const symmetric = rng.next() < profile.symmetricChance;
    const givens = digPuzzle(solution, rng, minGivens, symmetric);
    const grade = gradePuzzle(givens);
    const candidate: GeneratedPuzzle = {
      seed,
      generatorVersion: GENERATOR_VERSION,
      givens,
      solution,
      givensCount: countGivens(givens),
      grade,
    };
    const distance = Math.abs(RANK[grade.difficulty] - RANK[difficulty]);
    if (distance === 0) return candidate;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best!;
}
