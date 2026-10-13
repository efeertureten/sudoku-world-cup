import type { Difficulty } from './rules';

export interface League {
  slug: LeagueSlug;
  minTrophies: number;
  /** Puzzle difficulty served in ranked matches for this league. */
  difficulty: Difficulty;
}

export const LEAGUE_SLUGS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'champions'] as const;
export type LeagueSlug = (typeof LEAGUE_SLUGS)[number];

export const LEAGUES: readonly League[] = [
  { slug: 'bronze', minTrophies: 0, difficulty: 'easy' },
  { slug: 'silver', minTrophies: 400, difficulty: 'easy' },
  { slug: 'gold', minTrophies: 1000, difficulty: 'medium' },
  { slug: 'platinum', minTrophies: 1800, difficulty: 'medium' },
  { slug: 'diamond', minTrophies: 2800, difficulty: 'hard' },
  { slug: 'champions', minTrophies: 4000, difficulty: 'expert' },
];

export function leagueForTrophies(trophies: number): League {
  let current = LEAGUES[0]!;
  for (const league of LEAGUES) if (trophies >= league.minTrophies) current = league;
  return current;
}

export function nextLeague(slug: LeagueSlug): League | null {
  const i = LEAGUES.findIndex((l) => l.slug === slug);
  return LEAGUES[i + 1] ?? null;
}

export function leagueBySlug(slug: LeagueSlug): League {
  const league = LEAGUES.find((l) => l.slug === slug);
  if (!league) throw new Error(`Unknown league: ${slug}`);
  return league;
}
