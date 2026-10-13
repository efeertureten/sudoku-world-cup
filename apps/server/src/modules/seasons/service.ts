import type { SeasonInfo } from '@swcup/shared';
import { and, count, desc, gt, lte } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { seasons } from '../../db/schema';

const SEASON_LENGTH_DAYS = 28;

export type Season = typeof seasons.$inferSelect;

export function toSeasonInfo(s: Season): SeasonInfo {
  const number = Number(/\d+/.exec(s.name)?.[0] ?? s.id);
  return {
    id: s.id,
    number,
    name: s.name,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
  };
}

/** Returns the active season, creating the next one when the previous has ended. */
export async function ensureCurrentSeason(db: Db, now = new Date()): Promise<Season> {
  const [active] = await db
    .select()
    .from(seasons)
    .where(and(lte(seasons.startsAt, now), gt(seasons.endsAt, now)))
    .orderBy(desc(seasons.startsAt))
    .limit(1);
  if (active) return active;

  const [{ value: existing } = { value: 0 }] = await db.select({ value: count() }).from(seasons);
  const [last] = await db.select().from(seasons).orderBy(desc(seasons.endsAt)).limit(1);
  // Continue the calendar from the last season so gaps (server downtime) do not shift boundaries.
  let startsAt = last && last.endsAt <= now ? last.endsAt : now;
  let endsAt = new Date(startsAt.getTime() + SEASON_LENGTH_DAYS * 86_400_000);
  while (endsAt <= now) {
    startsAt = endsAt;
    endsAt = new Date(startsAt.getTime() + SEASON_LENGTH_DAYS * 86_400_000);
  }
  const [created] = await db
    .insert(seasons)
    .values({ name: `Season ${existing + 1}`, startsAt, endsAt })
    .returning();
  return created!;
}

/** Caches the current season in memory and rolls it over when it expires. */
export class SeasonClock {
  private current: Season | null = null;

  constructor(private readonly db: Db) {}

  async get(): Promise<Season> {
    if (this.current && this.current.endsAt.getTime() > Date.now()) return this.current;
    this.current = await ensureCurrentSeason(this.db);
    return this.current;
  }
}
