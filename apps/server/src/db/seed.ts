import { AVATARS, COSMETICS, COUNTRY_CODES, LEAGUES } from '@swcup/shared';
import { eq, sql } from 'drizzle-orm';
import type { Logger } from '../lib/logger';
import { ensureCurrentSeason } from '../modules/seasons/service';
import type { Db } from './client';
import { cosmetics, countries, leagues, playerStats, users } from './schema';

/**
 * Bot roster. Bots are ordinary user rows flagged `is_bot`, so foreign keys
 * and leaderboards need no special cases. They are always shown with a bot
 * badge in the UI.
 */
export const BOT_ROSTER: readonly [string, string][] = [
  ['Ayla_K', 'TR'],
  ['Mert.D', 'TR'],
  ['lucas_m', 'BR'],
  ['Rafa_10', 'ES'],
  ['Giulia.R', 'IT'],
  ['Hiro_S', 'JP'],
  ['Mina_J', 'KR'],
  ['Kofi_A', 'GH'],
  ['Amara.N', 'NG'],
  ['Sven_L', 'SE'],
  ['Ingrid.H', 'NO'],
  ['Jonas_B', 'DE'],
  ['Lea_M', 'FR'],
  ['Tomas.V', 'CZ'],
  ['Piotr_K', 'PL'],
  ['Olena.S', 'UA'],
  ['Diego_R', 'AR'],
  ['Camila.P', 'CL'],
  ['Mateo_G', 'UY'],
  ['Valen.C', 'CO'],
  ['Sofia_M', 'MX'],
  ['Ethan.W', 'US'],
  ['Chloe_T', 'CA'],
  ['Liam.O', 'IE'],
  ['Noah_V', 'NL'],
  ['Emma.D', 'DK'],
  ['Eero_K', 'FI'],
  ['Arnav.P', 'IN'],
  ['Zara_H', 'PK'],
  ['Youssef.B', 'MA'],
  ['Salma_E', 'EG'],
  ['Karim.T', 'TN'],
  ['Thabo_N', 'ZA'],
  ['Wanjiru.K', 'KE'],
  ['Aiko_T', 'JP'],
  ['Wei.L', 'CN'],
  ['Linh_N', 'VN'],
  ['Siti.R', 'MY'],
  ['Juan_D', 'PH'],
  ['Putu.W', 'ID'],
  ['Jack_M', 'AU'],
  ['Mia.K', 'NZ'],
  ['Nikos_P', 'GR'],
  ['Ana.F', 'PT'],
  ['Luka_B', 'HR'],
  ['Marko.J', 'RS'],
  ['Andrei_P', 'RO'],
  ['Bence.T', 'HU'],
  ['Elif_Y', 'TR'],
  ['Can.O', 'TR'],
  ['Nour_A', 'JO'],
  ['Omar.S', 'SA'],
  ['Reza_M', 'IR'],
  ['Dana.K', 'KZ'],
  ['Gio_M', 'GE'],
  ['Ani.H', 'AM'],
  ['Aziz_R', 'AZ'],
  ['Kai.S', 'DE'],
  ['Ines_L', 'BE'],
  ['Marc.S', 'CH'],
  ['Felix_W', 'AT'],
  ['Saoirse', 'IE'],
  ['Pedro.H', 'PE'],
  ['Ama_O', 'SN'],
];

/** Spreads bot ratings across the ladder so every skill level finds a sparring partner. */
export function botRating(index: number, total: number): number {
  return Math.round(900 + (1400 * index) / Math.max(1, total - 1));
}

export function trophiesForRating(rating: number): number {
  return Math.max(0, Math.round((rating - 900) * 2.2));
}

export async function seed(db: Db, log?: Logger): Promise<void> {
  await db
    .insert(countries)
    .values(COUNTRY_CODES.map((code) => ({ code })))
    .onConflictDoNothing();

  for (const league of LEAGUES) {
    await db
      .insert(leagues)
      .values({ slug: league.slug, minTrophies: league.minTrophies, difficulty: league.difficulty })
      .onConflictDoUpdate({
        target: leagues.slug,
        set: { minTrophies: league.minTrophies, difficulty: league.difficulty },
      });
  }

  for (const item of COSMETICS) {
    const values = {
      slug: item.slug,
      kind: item.kind,
      rarity: item.rarity,
      unlock: item.unlock,
      price: item.unlock.type === 'price' ? item.unlock.value : null,
    };
    await db.insert(cosmetics).values(values).onConflictDoUpdate({ target: cosmetics.slug, set: values });
  }

  await ensureCurrentSeason(db);

  let created = 0;
  for (const [index, [username, countryCode]] of BOT_ROSTER.entries()) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`)
      .limit(1);
    if (existing) continue;
    const rating = botRating(index, BOT_ROSTER.length);
    const trophies = trophiesForRating(rating);
    await db.transaction(async (tx) => {
      const [bot] = await tx
        .insert(users)
        .values({
          username,
          countryCode,
          isBot: true,
          isGuest: false,
          avatar: AVATARS[index % AVATARS.length]!.slug,
        })
        .returning({ id: users.id });
      await tx.insert(playerStats).values({
        userId: bot!.id,
        rating,
        ratingDeviation: 60,
        trophies,
        league: LEAGUES.filter((l) => trophies >= l.minTrophies).at(-1)!.slug,
      });
    });
    created++;
  }
  if (created > 0) log?.info({ created }, 'seeded bots');

  // Keep bot leagues consistent if league thresholds change between releases.
  for (const league of LEAGUES) {
    await db.execute(
      sql`update ${playerStats} set league = ${league.slug} where ${playerStats.trophies} >= ${league.minTrophies}`,
    );
  }
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.isBot, true));
}
