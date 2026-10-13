import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AVATARS,
  avatarSchema,
  BOARD_THEMES,
  boardThemeSchema,
  COUNTRY_CODES,
  DEFAULT_AVATAR_SLUG,
  DEFAULT_THEME_SLUG,
  guestInput,
  isEarnedBy,
  LEAGUES,
  leagueForTrophies,
  moveInput,
} from '../src';

const contentDir = join(__dirname, '../../../content');

describe('content registry', () => {
  it.each([
    ['themes', BOARD_THEMES, boardThemeSchema],
    ['avatars', AVATARS, avatarSchema],
  ] as const)('registers every %s file and each file is valid', (folder, registered, schema) => {
    const files = readdirSync(join(contentDir, folder)).filter((f) => f.endsWith('.json'));
    const slugs = new Set(registered.map((c) => c.slug));
    for (const file of files) {
      const data = JSON.parse(readFileSync(join(contentDir, folder, file), 'utf8'));
      expect(() => schema.parse(data), file).not.toThrow();
      expect(`${data.slug}.json`, 'file name must match slug').toBe(file);
      expect(slugs.has(data.slug), `${file} is not registered in packages/shared/src/cosmetics.ts`).toBe(
        true,
      );
    }
    expect(files).toHaveLength(registered.length);
  });

  it('has unique slugs and default items', () => {
    const all = [...BOARD_THEMES, ...AVATARS].map((c) => c.slug);
    expect(new Set(all).size).toBe(all.length);
    expect(BOARD_THEMES.some((t) => t.slug === DEFAULT_THEME_SLUG && t.unlock.type === 'default')).toBe(true);
    expect(AVATARS.some((a) => a.slug === DEFAULT_AVATAR_SLUG && a.unlock.type === 'default')).toBe(true);
  });

  it('evaluates unlock rules', () => {
    const progress = { trophies: 500, wins: 3, tournamentWins: 0 };
    expect(isEarnedBy({ type: 'trophies', value: 400 }, progress)).toBe(true);
    expect(isEarnedBy({ type: 'wins', value: 5 }, progress)).toBe(false);
    expect(isEarnedBy({ type: 'price', value: 10 }, progress)).toBe(false);
  });
});

describe('leagues', () => {
  it('maps trophies to leagues', () => {
    expect(leagueForTrophies(0).slug).toBe('bronze');
    expect(leagueForTrophies(399).slug).toBe('bronze');
    expect(leagueForTrophies(400).slug).toBe('silver');
    expect(leagueForTrophies(99_999).slug).toBe('champions');
    for (let i = 1; i < LEAGUES.length; i++) {
      expect(LEAGUES[i]!.minTrophies).toBeGreaterThan(LEAGUES[i - 1]!.minTrophies);
    }
  });
});

describe('schemas', () => {
  it('validates guests', () => {
    expect(guestInput.safeParse({ username: 'kaleci_1', countryCode: 'tr' }).data?.countryCode).toBe('TR');
    expect(guestInput.safeParse({ username: 'a', countryCode: 'TR' }).success).toBe(false);
    expect(guestInput.safeParse({ username: 'valid_name', countryCode: 'XX' }).success).toBe(false);
  });

  it('bounds moves', () => {
    const base = { matchId: '7f1c2a3e-8b9d-4c1e-9f2a-3b4c5d6e7f80', seq: 1, cell: 0, value: 1 };
    expect(moveInput.safeParse(base).success).toBe(true);
    expect(moveInput.safeParse({ ...base, cell: 81 }).success).toBe(false);
    expect(moveInput.safeParse({ ...base, value: 0 }).success).toBe(false);
  });

  it('has 243 playable countries without duplicates', () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES.length).toBe(243);
  });
});
