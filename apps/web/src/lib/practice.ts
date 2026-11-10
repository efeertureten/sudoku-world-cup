import { type Difficulty, generatePuzzle, serializeGrid } from '@swcup/engine';
import { bit, PEERS } from '@swcup/engine/codec';

/**
 * Solo practice runs entirely in the browser: the engine generates a puzzle with a
 * unique solution, and every rule below is checked locally. Nothing here talks to the
 * server, so it works offline and on static hosting.
 *
 * All functions are pure (they return a new game) so they are easy to test and to undo.
 */

export const PRACTICE_VERSION = 1;
const UNDO_LIMIT = 300;

export interface UndoStep {
  cell: number;
  value: number;
  notes: number;
  /** Peer notes cleared by this move, restored on undo as [cell, previousMask]. */
  peerNotes: [number, number][];
}

export interface PracticeGame {
  v: typeof PRACTICE_VERSION;
  seed: number;
  difficulty: Difficulty;
  /** 81 characters, '0' for an empty cell. */
  givens: string;
  solution: string;
  board: number[];
  /** One 9-bit mask per cell (bit d-1 set = digit d is pencilled in). */
  notes: number[];
  mistakes: number;
  hints: number;
  /** Time actually spent playing, in milliseconds. */
  elapsedMs: number;
  done: boolean;
  undo: UndoStep[];
}

export type MoveResult = 'placed' | 'wrong' | 'noted' | 'ignored';

export function createGame(difficulty: Difficulty, seed = randomSeed()): PracticeGame {
  const puzzle = generatePuzzle(seed, difficulty);
  const givens = serializeGrid(puzzle.givens);
  return {
    v: PRACTICE_VERSION,
    seed,
    difficulty,
    givens,
    solution: serializeGrid(puzzle.solution),
    board: Array.from(givens, Number),
    notes: new Array(81).fill(0),
    mistakes: 0,
    hints: 0,
    elapsedMs: 0,
    done: false,
    undo: [],
  };
}

export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! >>> 1;
}

export const isGiven = (game: PracticeGame, cell: number): boolean => game.givens[cell] !== '0';

export function isSolved(game: PracticeGame): boolean {
  return game.board.every((v, i) => v === Number(game.solution[i]));
}

function pushUndo(game: PracticeGame, step: UndoStep): UndoStep[] {
  const next = [...game.undo, step];
  return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next;
}

/** Places `digit` in `cell`. A wrong digit is rejected and counted as a mistake. */
export function placeDigit(
  game: PracticeGame,
  cell: number,
  digit: number,
): { game: PracticeGame; result: MoveResult } {
  if (game.done || isGiven(game, cell) || game.board[cell] !== 0) return { game, result: 'ignored' };
  if (digit !== Number(game.solution[cell])) {
    return { game: { ...game, mistakes: game.mistakes + 1 }, result: 'wrong' };
  }
  const board = game.board.slice();
  const notes = game.notes.slice();
  const peerNotes: [number, number][] = [];
  const previousNotes = notes[cell]!;
  board[cell] = digit;
  notes[cell] = 0;
  for (const peer of PEERS[cell]!) {
    if (notes[peer]! & bit(digit)) {
      peerNotes.push([peer, notes[peer]!]);
      notes[peer] = notes[peer]! & ~bit(digit);
    }
  }
  const next: PracticeGame = {
    ...game,
    board,
    notes,
    undo: pushUndo(game, { cell, value: 0, notes: previousNotes, peerNotes }),
  };
  next.done = isSolved(next);
  return { game: next, result: 'placed' };
}

/** Toggles a pencil mark. Filled cells and givens cannot carry notes. */
export function toggleNote(
  game: PracticeGame,
  cell: number,
  digit: number,
): { game: PracticeGame; result: MoveResult } {
  if (game.done || game.board[cell] !== 0) return { game, result: 'ignored' };
  const notes = game.notes.slice();
  const previous = notes[cell]!;
  notes[cell] = previous ^ bit(digit);
  return {
    game: {
      ...game,
      notes,
      undo: pushUndo(game, { cell, value: 0, notes: previous, peerNotes: [] }),
    },
    result: 'noted',
  };
}

/** Clears the pencil notes of a cell. Placed digits are always correct, so they are never erased. */
export function eraseCell(game: PracticeGame, cell: number): PracticeGame {
  if (game.done || isGiven(game, cell)) return game;
  if (game.notes[cell] === 0) return game;
  const notes = game.notes.slice();
  const previous = notes[cell]!;
  notes[cell] = 0;
  return {
    ...game,
    notes,
    undo: pushUndo(game, { cell, value: 0, notes: previous, peerNotes: [] }),
  };
}

/** Reveals the correct digit of one cell. Counted separately from mistakes. */
export function giveHint(game: PracticeGame, cell: number): { game: PracticeGame; result: MoveResult } {
  if (game.done || isGiven(game, cell) || game.board[cell] !== 0) return { game, result: 'ignored' };
  const placed = placeDigit(game, cell, Number(game.solution[cell]));
  return { game: { ...placed.game, hints: game.hints + 1 }, result: placed.result };
}

/** The first empty cell, preferring the one with the fewest candidates (a "naked single" first). */
export function suggestCell(game: PracticeGame): number | null {
  let best: number | null = null;
  let bestCount = 10;
  for (let i = 0; i < 81; i++) {
    if (game.board[i] !== 0) continue;
    const seen = new Set<number>();
    for (const p of PEERS[i]!) if (game.board[p]) seen.add(game.board[p]!);
    const count = 9 - seen.size;
    if (count < bestCount) {
      best = i;
      bestCount = count;
    }
  }
  return best;
}

export function undoMove(game: PracticeGame): PracticeGame {
  if (game.done) return game;
  const last = game.undo[game.undo.length - 1];
  if (!last) return game;
  const board = game.board.slice();
  const notes = game.notes.slice();
  board[last.cell] = last.value;
  notes[last.cell] = last.notes;
  for (const [peer, mask] of last.peerNotes) notes[peer] = mask;
  return { ...game, board, notes, undo: game.undo.slice(0, -1) };
}

/** Digits that are not yet placed 9 times, so the pad can dim finished digits. */
export function remainingDigits(board: number[]): number[] {
  const counts = new Array(10).fill(9);
  for (const v of board) if (v) counts[v]--;
  return counts;
}

/** Sanity check for a saved game: placed digits are always correct, so any deviation means a corrupted save. */
export function isConsistent(game: PracticeGame): boolean {
  if (game.board.length !== 81 || game.notes.length !== 81) return false;
  if (game.givens.length !== 81 || game.solution.length !== 81) return false;
  return game.board.every((v, i) => v === 0 || v === Number(game.solution[i]));
}

// --- Persistence ---------------------------------------------------------------------------

const GAME_KEY = 'swc.practice.game';
const BEST_KEY = 'swc.practice.best';

export type BestTimes = Partial<Record<Difficulty, number>>;

export function loadGame(): PracticeGame | null {
  try {
    const raw = localStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const game = JSON.parse(raw) as PracticeGame;
    if (game.v !== PRACTICE_VERSION || !isConsistent(game)) return null;
    return game;
  } catch {
    return null;
  }
}

export function saveGame(game: PracticeGame | null): void {
  try {
    if (game === null) localStorage.removeItem(GAME_KEY);
    else localStorage.setItem(GAME_KEY, JSON.stringify(game));
  } catch {
    /* private mode or full storage: the game just will not resume */
  }
}

export function loadBestTimes(): BestTimes {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as BestTimes) : {};
  } catch {
    return {};
  }
}

/** Records a finished game. Hints disqualify a time from the personal best. Returns true on a new best. */
export function recordFinish(game: PracticeGame): boolean {
  if (game.hints > 0) return false;
  const best = loadBestTimes();
  const previous = best[game.difficulty];
  if (previous !== undefined && previous <= game.elapsedMs) return false;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify({ ...best, [game.difficulty]: game.elapsedMs }));
  } catch {
    return false;
  }
  return true;
}
