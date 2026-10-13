import { generatePuzzle, serializeGrid } from '@swcup/engine';
import type { TournamentPlayer } from '@swcup/shared';
import { describe, expect, it } from 'vitest';
import type { MoveRecord } from '../src/db/schema';
import { analyzeMoves } from '../src/modules/anticheat/analyzer';
import { botParamsFor, decideNextMove, humanJitter } from '../src/modules/bot/brain';
import { searchWindow } from '../src/modules/matchmaking/service';
import { expectedScore, glicko2Update } from '../src/modules/rating/glicko2';
import {
  BOT_COUNTRY_POINTS_DAILY_CAP,
  BOT_WIN_COUNTRY_POINTS,
  cappedBotPoints,
  countryPoints,
  matchCoins,
  placementForElimination,
  trophyDelta,
} from '../src/modules/rating/rewards';
import { emptyBracket, SEED_ORDER, simulatedWinner } from '../src/modules/tournament/service';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('glicko-2', () => {
  it('reproduces the example from Glickman (2012) in direction and size', () => {
    const player = { rating: 1500, rd: 200, vol: 0.06 };
    const win = glicko2Update(player, { rating: 1400, rd: 30, vol: 0.06 }, 1);
    const loss = glicko2Update(player, { rating: 1400, rd: 30, vol: 0.06 }, 0);
    expect(win.rating).toBeGreaterThan(1500);
    expect(loss.rating).toBeLessThan(1500);
    expect(win.rd).toBeLessThan(200);
    expect(Math.abs(win.vol - 0.06)).toBeLessThan(0.001);
  });

  it('moves less against a much weaker opponent', () => {
    const p = { rating: 1800, rd: 80, vol: 0.06 };
    const easyWin = glicko2Update(p, { rating: 1200, rd: 80, vol: 0.06 }, 1);
    const hardWin = glicko2Update(p, { rating: 2200, rd: 80, vol: 0.06 }, 1);
    expect(hardWin.rating - 1800).toBeGreaterThan(easyWin.rating - 1800);
    expect(expectedScore(p, { rating: 1200, rd: 80, vol: 0.06 })).toBeGreaterThan(0.9);
  });
});

describe('rewards', () => {
  it('pays more for beating stronger players and never goes below zero', () => {
    const upset = trophyDelta({ myTrophies: 500, opponentTrophies: 900, outcome: 'win', vsBot: false });
    const expected = trophyDelta({ myTrophies: 900, opponentTrophies: 500, outcome: 'win', vsBot: false });
    expect(upset).toBeGreaterThan(expected);
    expect(trophyDelta({ myTrophies: 5, opponentTrophies: 5, outcome: 'loss', vsBot: false })).toBe(-5);
    expect(trophyDelta({ myTrophies: 600, opponentTrophies: 600, outcome: 'draw', vsBot: false })).toBe(0);
  });

  it('halves bot matches and caps the country points they give', () => {
    const human = trophyDelta({ myTrophies: 600, opponentTrophies: 600, outcome: 'win', vsBot: false });
    const bot = trophyDelta({ myTrophies: 600, opponentTrophies: 600, outcome: 'win', vsBot: true });
    expect(bot).toBe(Math.round(human / 2));
    expect(
      countryPoints({ type: 'ranked', outcome: 'win', vsBot: true, myTrophies: 0, opponentTrophies: 0 }),
    ).toBe(BOT_WIN_COUNTRY_POINTS);
    expect(
      countryPoints({ type: 'casual', outcome: 'win', vsBot: false, myTrophies: 0, opponentTrophies: 0 }),
    ).toBe(0);
    expect(cappedBotPoints(BOT_WIN_COUNTRY_POINTS, 0)).toBe(BOT_WIN_COUNTRY_POINTS);
    expect(cappedBotPoints(BOT_WIN_COUNTRY_POINTS, BOT_COUNTRY_POINTS_DAILY_CAP - 1)).toBe(1);
    expect(cappedBotPoints(BOT_WIN_COUNTRY_POINTS, BOT_COUNTRY_POINTS_DAILY_CAP)).toBe(0);
    expect(
      countryPoints({
        type: 'tournament',
        outcome: 'win',
        vsBot: false,
        myTrophies: 0,
        opponentTrophies: 0,
        round: 3,
      }),
    ).toBe(80);
    expect(matchCoins('ranked', 'win', true)).toBeLessThan(matchCoins('ranked', 'win', false));
  });

  it('maps eliminations to placements', () => {
    expect([0, 1, 2, 3].map(placementForElimination)).toEqual([9, 5, 3, 2]);
  });
});

describe('matchmaking window', () => {
  it('widens with waiting time up to a cap', () => {
    expect(searchWindow(0)).toBe(50);
    expect(searchWindow(2_000)).toBe(150);
    expect(searchWindow(60_000)).toBe(400);
  });
});

describe('tournament bracket', () => {
  it('uses every seed once and keeps seeds 1 and 2 apart until the final', () => {
    expect(new Set(SEED_ORDER).size).toBe(16);
    const half = (seed: number) => (SEED_ORDER.indexOf(seed) < 8 ? 'top' : 'bottom');
    expect(half(1)).not.toBe(half(2));
    const rounds = emptyBracket(16);
    expect(rounds.map((r) => r.length)).toEqual([8, 4, 2, 1]);
  });

  it('favours the stronger bot in simulations', () => {
    const strong: TournamentPlayer = {
      userId: 's',
      username: 's',
      countryCode: 'TR',
      avatar: 'x',
      isBot: true,
      trophies: 3000,
    };
    const weak: TournamentPlayer = { ...strong, userId: 'w', trophies: 100 };
    const random = seeded(1);
    let strongWins = 0;
    for (let i = 0; i < 500; i++) if (simulatedWinner(strong, weak, random) === 's') strongWins++;
    expect(strongWins).toBeGreaterThan(400);
  });
});

/** Plays a whole puzzle with the bot brain and returns its move log. */
function botGame(seed: number, difficulty: 'easy' | 'medium' | 'hard') {
  const puzzle = generatePuzzle(seed, difficulty);
  const givens = serializeGrid(puzzle.givens);
  const solution = serializeGrid(puzzle.solution);
  const random = seeded(seed);
  const params = botParamsFor(1500, difficulty, null, random);
  const board = puzzle.givens.slice();
  const moves: MoveRecord[] = [];
  let t = 3000;
  let mistakes = 0;
  let last: number | null = null;
  for (let guard = 0; guard < 400; guard++) {
    const d = decideNextMove({ board, solution, lastCell: last, params, mistakes, maxMistakes: 3, random });
    if (!d) break;
    t += d.thinkMs;
    moves.push({ cell: d.cell, value: d.value, ok: d.correct, t });
    if (d.correct) {
      board[d.cell] = d.value;
      last = d.cell;
    } else {
      mistakes++;
      t += 3000;
    }
  }
  return { givens, solution, moves, board, mistakes };
}

describe('bot brain', () => {
  it('finishes puzzles with human-like pacing', () => {
    const { board, solution, moves } = botGame(42, 'easy');
    expect(serializeGrid(board)).toBe(solution);
    const intervals = moves.slice(1).map((m, i) => m.t - moves[i]!.t);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    expect(mean).toBeGreaterThan(1500);
  });

  it('has a mean-one jitter', () => {
    const random = seeded(7);
    let sum = 0;
    for (let i = 0; i < 20_000; i++) sum += humanJitter(random);
    expect(sum / 20_000).toBeGreaterThan(0.95);
    expect(sum / 20_000).toBeLessThan(1.05);
  });
});

describe('anti-cheat analyzer', () => {
  it('does not flag bots, which imitate human play', () => {
    for (const [seed, difficulty] of [
      [1, 'easy'],
      [2, 'medium'],
      [3, 'hard'],
      [4, 'medium'],
    ] as const) {
      const game = botGame(seed * 1000, difficulty);
      const result = analyzeMoves(game.givens, game.moves, difficulty);
      expect(result.flagged, JSON.stringify(result)).toBe(false);
    }
  });

  it('flags solver-style play: index order, metronomic and fast', () => {
    const puzzle = generatePuzzle(77, 'medium');
    const givens = serializeGrid(puzzle.givens);
    const moves: MoveRecord[] = [];
    let t = 500;
    for (let cell = 0; cell < 81; cell++) {
      if (puzzle.givens[cell] !== 0) continue;
      t += 400;
      moves.push({ cell, value: puzzle.solution[cell]!, ok: true, t });
    }
    const result = analyzeMoves(givens, moves, 'medium');
    expect(result.flagged).toBe(true);
    expect(result.reasons).toContain('index_order_filling');
  });

  it('flags a solver copied in random order at a human pace', () => {
    let flagged = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const puzzle = generatePuzzle(seed * 31, 'medium');
      const random = seeded(seed);
      const cells = [...puzzle.givens.keys()]
        .filter((c) => puzzle.givens[c] === 0)
        .sort(() => random() - 0.5);
      let t = 2000;
      const moves = cells.map((cell) => {
        t += 1500 + random() * 6000;
        return { cell, value: puzzle.solution[cell]!, ok: true, t };
      });
      const result = analyzeMoves(serializeGrid(puzzle.givens), moves, 'medium');
      if (result.reasons.includes('fills_undeducible_cells')) flagged++;
    }
    expect(flagged).toBeGreaterThanOrEqual(7);
  });

  it('ignores very short games', () => {
    expect(analyzeMoves('0'.repeat(81), [{ cell: 0, value: 1, ok: true, t: 1 }], 'easy').score).toBe(0);
  });
});
