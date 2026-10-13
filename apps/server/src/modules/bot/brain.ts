import { candidateMask, findSingles, isPeer, MASK_DIGITS, POPCOUNT } from '@swcup/engine';
import type { Difficulty } from '@swcup/shared';

/**
 * Pure decision logic for bots, kept free of I/O so it can be unit tested and
 * so anti-cheat can be tested against it ("bots must look human").
 *
 * A bot plays like a person: it looks for cells that are deducible right now
 * (naked or hidden singles), prefers the area it just worked in, slows down
 * when only advanced deductions are left, and sometimes slips.
 */
export interface BotParams {
  /** Average think time per solved cell. */
  msPerCell: number;
  /** Base probability of placing a wrong digit. */
  errorRate: number;
}

export interface BotDecision {
  cell: number;
  value: number;
  correct: boolean;
  thinkMs: number;
}

export type Random = () => number;

const BASE_MS_PER_CELL: Record<Difficulty, number> = {
  easy: 3800,
  medium: 4800,
  hard: 7000,
  expert: 9000,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * When the human has history on this difficulty the bot targets their own
 * pace (±20%), which keeps bot matches close to a coin flip. Otherwise the
 * pace follows the bot's rating.
 */
export function botParamsFor(
  botRating: number,
  difficulty: Difficulty,
  humanMsPerCell: number | null,
  random: Random,
): BotParams {
  const msPerCell =
    humanMsPerCell !== null
      ? humanMsPerCell * (0.85 + random() * 0.4)
      : BASE_MS_PER_CELL[difficulty] * 2 ** ((1500 - botRating) / 600) * (0.9 + random() * 0.2);
  const errorRate = clamp(0.06 - ((botRating - 900) / 1400) * 0.045, 0.012, 0.06);
  return { msPerCell: clamp(msPerCell, 1300, 25_000), errorRate };
}

function gaussian(random: Random): number {
  const u = Math.max(random(), 1e-9);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Log-normal multiplier with mean 1: occasional long pauses, never metronomic. */
export function humanJitter(random: Random, sigma = 0.5): number {
  return Math.exp(sigma * gaussian(random) - (sigma * sigma) / 2);
}

function weightedPick<T>(items: T[], weight: (item: T) => number, random: Random): T {
  const weights = items.map(weight);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

export function decideNextMove(args: {
  board: Uint8Array;
  solution: string;
  lastCell: number | null;
  params: BotParams;
  mistakes: number;
  maxMistakes: number;
  random: Random;
}): BotDecision | null {
  const { board, solution, lastCell, params, mistakes, maxMistakes, random } = args;
  let cell: number;
  let effort: number;
  let deducible: boolean;

  const singles = findSingles(board);
  if (singles.length > 0) {
    const pick = weightedPick(
      singles,
      (s) => (lastCell !== null && isPeer(lastCell, s.cell) ? 2.5 : 1) * (s.kind === 'naked' ? 1.2 : 1),
      random,
    );
    cell = pick.cell;
    effort = pick.kind === 'naked' ? 0.9 : 1;
    deducible = true;
  } else {
    // Only advanced techniques remain: think longer, then commit to the tightest cell.
    let best: number[] = [];
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (board[i]) continue;
      const n = POPCOUNT[candidateMask(board, i)]!;
      if (n < bestCount) {
        best = [i];
        bestCount = n;
      } else if (n === bestCount) {
        best.push(i);
      }
    }
    if (best.length === 0) return null;
    cell = best[Math.floor(random() * best.length)]!;
    effort = 2.2 + 0.3 * Math.max(0, bestCount - 2);
    deducible = false;
  }

  const correctValue = Number(solution[cell]);
  let errorChance = params.errorRate * (deducible ? 1 : 2.5);
  if (mistakes >= maxMistakes - 1) errorChance *= 0.1; // a careful player slows down on their last card
  let value = correctValue;
  if (random() < errorChance) {
    const options = MASK_DIGITS[candidateMask(board, cell)]!.filter((d) => d !== correctValue);
    const pool = options.length > 0 ? options : [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => d !== correctValue);
    value = pool[Math.floor(random() * pool.length)]!;
  }

  const thinkMs = Math.max(600, Math.round(params.msPerCell * effort * humanJitter(random)));
  return { cell, value, correct: value === correctValue, thinkMs };
}
