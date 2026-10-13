import { isSinglePlacement } from '@swcup/engine';
import type { Difficulty } from '@swcup/shared';
import type { MoveRecord } from '../../db/schema';

/**
 * Post-match behavioural analysis.
 *
 * A computer solves Sudoku in milliseconds, so we cannot stop a client from
 * consulting a solver. What we can do is notice play that does not look human:
 * metronome-like timing, filling cells in index order, and above all placing
 * digits that were not deducible (as a naked or hidden single) from the
 * player's own board at that moment.
 * The result is a score; reviewers decide, nothing is banned automatically.
 */
export interface CheatSignals {
  correctMoves: number;
  intervalCv: number | null;
  medianIntervalMs: number | null;
  ascendingRatio: number | null;
  /** Share of the first 20 fills that were not a naked/hidden single on the player's board. */
  earlyNonSingleRatio: number | null;
  nonSingleRatio: number | null;
  msPerCell: number | null;
}

export interface CheatAnalysis {
  score: number;
  flagged: boolean;
  reasons: string[];
  signals: CheatSignals;
}

export const FLAG_THRESHOLD = 0.6;
const MIN_MOVES = 12;

/** Fastest plausible human pace per solved cell, by difficulty. */
const MIN_HUMAN_MS_PER_CELL: Record<Difficulty, number> = {
  easy: 900,
  medium: 1200,
  hard: 1800,
  expert: 2500,
};

/**
 * Early in a game a person can only place digits they can deduce, which on a
 * raw board almost always means a single. Someone copying a solver fills
 * arbitrary cells. Thresholds were calibrated against the bot brain (human
 * proxy, ~0-0.3) and random-order solver play (~0.15-0.8).
 */
const EARLY_WINDOW = 20;
const NON_SINGLE_THRESHOLDS: Record<Difficulty, [strong: number, weak: number]> = {
  easy: [0.3, 0.15],
  medium: [0.35, 0.2],
  hard: [0.45, 0.3],
  expert: [0.5, 0.35],
};

export function analyzeMoves(givens: string, moves: MoveRecord[], difficulty: Difficulty): CheatAnalysis {
  const correct = moves.filter((m) => m.ok);
  const signals: CheatSignals = {
    correctMoves: correct.length,
    intervalCv: null,
    medianIntervalMs: null,
    ascendingRatio: null,
    earlyNonSingleRatio: null,
    nonSingleRatio: null,
    msPerCell: null,
  };
  if (correct.length < MIN_MOVES) return { score: 0, flagged: false, reasons: [], signals };

  const intervals: number[] = [];
  for (let i = 1; i < moves.length; i++) intervals.push(Math.max(0, moves[i]!.t - moves[i - 1]!.t));
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
  signals.intervalCv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const sorted = [...intervals].sort((a, b) => a - b);
  signals.medianIntervalMs = sorted[Math.floor(sorted.length / 2)]!;

  let ascending = 0;
  for (let i = 1; i < correct.length; i++) if (correct[i]!.cell > correct[i - 1]!.cell) ascending++;
  signals.ascendingRatio = ascending / (correct.length - 1);

  // Replay the player's own board: was each fill a single at that moment?
  const board = Uint8Array.from(givens, (ch) => Number(ch));
  let nonSingles = 0;
  let earlyNonSingles = 0;
  const earlyCount = Math.min(EARLY_WINDOW, correct.length);
  correct.forEach((move, i) => {
    if (!isSinglePlacement(board, move.cell, move.value)) {
      nonSingles++;
      if (i < earlyCount) earlyNonSingles++;
    }
    board[move.cell] = move.value;
  });
  signals.nonSingleRatio = nonSingles / correct.length;
  signals.earlyNonSingleRatio = earlyNonSingles / earlyCount;
  signals.msPerCell = correct.at(-1)!.t / correct.length;

  let score = 0;
  const reasons: string[] = [];
  if (signals.intervalCv < 0.15) {
    score += 0.45;
    reasons.push('metronomic_timing');
  } else if (signals.intervalCv < 0.25) {
    score += 0.3;
    reasons.push('regular_timing');
  }
  if (signals.medianIntervalMs < 700) {
    score += 0.3;
    reasons.push('superhuman_pace');
  }
  if (signals.ascendingRatio > 0.85) {
    score += 0.3;
    reasons.push('index_order_filling');
  }
  // Harder puzzles legitimately need more advanced steps between singles.
  const [strong, weak] = NON_SINGLE_THRESHOLDS[difficulty];
  if (signals.earlyNonSingleRatio > strong) {
    score += 0.4;
    reasons.push('fills_undeducible_cells');
  } else if (signals.earlyNonSingleRatio > weak) {
    score += 0.2;
    reasons.push('often_fills_undeducible_cells');
  }
  if (signals.msPerCell < MIN_HUMAN_MS_PER_CELL[difficulty]) {
    score += 0.3;
    reasons.push('implausible_total_time');
  }

  score = Math.min(1, Math.round(score * 100) / 100);
  return { score, flagged: score >= FLAG_THRESHOLD, reasons, signals };
}
