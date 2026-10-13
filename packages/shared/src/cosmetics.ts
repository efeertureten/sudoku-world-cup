import { z } from 'zod';
import awayNavy from '../../../content/avatars/away-navy.json';
import checkerboard from '../../../content/avatars/checkerboard.json';
import classicStripes from '../../../content/avatars/classic-stripes.json';
import emeraldHoops from '../../../content/avatars/emerald-hoops.json';
import goldenCaptain from '../../../content/avatars/golden-captain.json';
import homeWhite from '../../../content/avatars/home-white.json';
import neonKeeper from '../../../content/avatars/neon-keeper.json';
import redSash from '../../../content/avatars/red-sash.json';
import skyPinstripe from '../../../content/avatars/sky-pinstripe.json';
import splitHalves from '../../../content/avatars/split-halves.json';
import carnival from '../../../content/themes/carnival.json';
import classicPitch from '../../../content/themes/classic-pitch.json';
import floodlights from '../../../content/themes/floodlights.json';
import goldenTrophy from '../../../content/themes/golden-trophy.json';
import iceDerby from '../../../content/themes/ice-derby.json';
import retroProgramme from '../../../content/themes/retro-programme.json';
import sunsetTerrace from '../../../content/themes/sunset-terrace.json';
import tacticsBoard from '../../../content/themes/tactics-board.json';

/**
 * Cosmetics are data, not code: a board theme or avatar is one JSON file in
 * /content. To add one, drop the file there and register it in the lists
 * below. The test suite fails if a file is missing from the registry or does
 * not match the schema.
 */
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #RRGGBB color');
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Expected a kebab-case slug');
const localizedName = z.object({ tr: z.string().min(1).max(40), en: z.string().min(1).max(40) });

export const unlockRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('default') }),
  z.object({ type: z.literal('trophies'), value: z.number().int().positive() }),
  z.object({ type: z.literal('wins'), value: z.number().int().positive() }),
  z.object({ type: z.literal('tournament_wins'), value: z.number().int().positive() }),
  z.object({ type: z.literal('price'), value: z.number().int().positive() }),
]);
export type UnlockRule = z.infer<typeof unlockRuleSchema>;

export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;

export const boardThemeSchema = z.object({
  slug,
  kind: z.literal('board_theme'),
  name: localizedName,
  rarity: z.enum(RARITIES),
  unlock: unlockRuleSchema,
  colors: z.object({
    frame: hex,
    cell: hex,
    cellAlt: hex,
    line: hex,
    given: hex,
    input: hex,
    accent: hex,
    peer: hex,
    same: hex,
    error: hex,
    note: hex,
  }),
});
export type BoardTheme = z.infer<typeof boardThemeSchema>;

export const JERSEY_PATTERNS = [
  'plain',
  'stripes',
  'hoops',
  'sash',
  'halves',
  'checkers',
  'pinstripes',
] as const;

export const avatarSchema = z.object({
  slug,
  kind: z.literal('avatar'),
  name: localizedName,
  rarity: z.enum(RARITIES),
  unlock: unlockRuleSchema,
  art: z.object({
    shape: z.literal('jersey'),
    primary: hex,
    secondary: hex,
    pattern: z.enum(JERSEY_PATTERNS),
    number: z.number().int().min(1).max(99),
  }),
});
export type Avatar = z.infer<typeof avatarSchema>;

export type Cosmetic = BoardTheme | Avatar;
export type CosmeticKind = Cosmetic['kind'];

export const BOARD_THEMES: readonly BoardTheme[] = [
  classicPitch,
  floodlights,
  tacticsBoard,
  retroProgramme,
  sunsetTerrace,
  iceDerby,
  goldenTrophy,
  carnival,
].map((t) => boardThemeSchema.parse(t));

export const AVATARS: readonly Avatar[] = [
  homeWhite,
  awayNavy,
  classicStripes,
  emeraldHoops,
  redSash,
  splitHalves,
  checkerboard,
  skyPinstripe,
  goldenCaptain,
  neonKeeper,
].map((a) => avatarSchema.parse(a));

export const COSMETICS: readonly Cosmetic[] = [...BOARD_THEMES, ...AVATARS];

export const DEFAULT_THEME_SLUG = 'classic-pitch';
export const DEFAULT_AVATAR_SLUG = 'home-white';

export function findCosmetic(slugValue: string): Cosmetic | undefined {
  return COSMETICS.find((c) => c.slug === slugValue);
}

export function themeBySlug(slugValue: string | null | undefined): BoardTheme {
  return (
    BOARD_THEMES.find((t) => t.slug === slugValue) ?? BOARD_THEMES.find((t) => t.slug === DEFAULT_THEME_SLUG)!
  );
}

export function avatarBySlug(slugValue: string | null | undefined): Avatar {
  return AVATARS.find((a) => a.slug === slugValue) ?? AVATARS.find((a) => a.slug === DEFAULT_AVATAR_SLUG)!;
}

export interface UnlockProgress {
  trophies: number;
  wins: number;
  tournamentWins: number;
}

/** Whether progress alone unlocks a cosmetic (price-based items must be bought). */
export function isEarnedBy(rule: UnlockRule, progress: UnlockProgress): boolean {
  switch (rule.type) {
    case 'default':
      return true;
    case 'trophies':
      return progress.trophies >= rule.value;
    case 'wins':
      return progress.wins >= rule.value;
    case 'tournament_wins':
      return progress.tournamentWins >= rule.value;
    case 'price':
      return false;
  }
}
