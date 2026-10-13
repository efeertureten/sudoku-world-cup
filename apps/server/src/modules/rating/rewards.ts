import type { MatchType } from '@swcup/shared';

/**
 * Every number that turns a match result into trophies, coins and country
 * points lives here so balancing is a one-file change with unit tests.
 */
export type Outcome = 'win' | 'loss' | 'draw';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Visible trophies; only ranked matches move them. Bots count half. */
export function trophyDelta(args: {
  myTrophies: number;
  opponentTrophies: number;
  outcome: Outcome;
  vsBot: boolean;
}): number {
  const { myTrophies, opponentTrophies, outcome, vsBot } = args;
  let delta = 0;
  if (outcome === 'win') {
    delta = 30 + clamp(Math.round((opponentTrophies - myTrophies) / 20), -10, 10);
  } else if (outcome === 'loss') {
    delta = -(20 + clamp(Math.round((myTrophies - opponentTrophies) / 25), -8, 8));
    // New players in the first league lose half as much while they learn.
    if (myTrophies < 400) delta = Math.round(delta / 2);
  }
  if (vsBot) delta = Math.round(delta / 2);
  return Math.max(-myTrophies, delta);
}

const COINS: Record<MatchType, Record<Outcome, number>> = {
  ranked: { win: 25, loss: 8, draw: 12 },
  casual: { win: 12, loss: 4, draw: 6 },
  tournament: { win: 15, loss: 5, draw: 5 },
};

export function matchCoins(type: MatchType, outcome: Outcome, vsBot: boolean): number {
  const base = COINS[type][outcome];
  return vsBot && type !== 'tournament' ? Math.round(base * 0.6) : base;
}

/**
 * Beating a bot in a ranked or cup match still scores a little for the
 * country, so the table is alive on a small server, but those points are
 * capped per player per UTC day so nobody can farm bots up the standings.
 */
export const BOT_WIN_COUNTRY_POINTS = 3;
export const BOT_COUNTRY_POINTS_DAILY_CAP = 30;

/** Points a win adds to the player's country. Casual matches never score. */
export function countryPoints(args: {
  type: MatchType;
  outcome: Outcome;
  vsBot: boolean;
  myTrophies: number;
  opponentTrophies: number;
  round?: number;
}): number {
  if (args.outcome !== 'win' || args.type === 'casual') return 0;
  if (args.vsBot) return BOT_WIN_COUNTRY_POINTS;
  if (args.type === 'ranked') return 10 + (args.opponentTrophies > args.myTrophies ? 5 : 0);
  return [10, 20, 40, 80][args.round ?? 0] ?? 10;
}

/** How many bot points still fit under today's cap. */
export function cappedBotPoints(points: number, alreadyToday: number): number {
  return Math.max(0, Math.min(points, BOT_COUNTRY_POINTS_DAILY_CAP - alreadyToday));
}

/** Final placement -> coins, for human players when a tournament ends. */
export const TOURNAMENT_PLACEMENT_COINS: Record<number, number> = { 1: 300, 2: 150, 3: 75, 5: 30, 9: 10 };
/** Champion bonus for the country: full when at least two people entered, small for a cup against bots. */
export const CHAMPION_COUNTRY_BONUS = 50;
export const BOT_CUP_CHAMPION_COUNTRY_BONUS = 10;

/** Placement for a player eliminated in `round` (0 = round of 16). */
export function placementForElimination(round: number): number {
  return [9, 5, 3, 2][round] ?? 9;
}
