import type { CountryStanding, LeagueSlug, PlayerStanding } from '@swcup/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { countrySeasonScores, playerStats, users } from '../../db/schema';
import { LEADERBOARD_ROOM, type Realtime } from '../../socket/realtime';
import type { SeasonClock } from '../seasons/service';

const CACHE_MS = 5_000;

/**
 * Season standings. Postgres is the source of truth (an append-only ledger
 * plus a per-country running total); reads are cached for a few seconds and
 * the leader pushes the top countries to watchers when they change.
 *
 * Two metrics: "total" rewards large player bases, "top50" sums each
 * country's best 50 contributors so smaller nations can compete.
 */
export class LeaderboardService {
  private cache = new Map<string, { at: number; data: CountryStanding[] }>();
  private lastBroadcast = '';

  constructor(
    private readonly db: Db,
    private readonly seasons: SeasonClock,
    private readonly realtime: Realtime,
  ) {}

  async countries(metric: 'total' | 'top50', seasonId?: number, limit = 100): Promise<CountryStanding[]> {
    const season = seasonId ?? (await this.seasons.get()).id;
    const cacheKey = `${metric}:${season}:${limit}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

    const rows =
      metric === 'total'
        ? await this.db.execute<{ country_code: string; points: number; players: number }>(sql`
            select s.country_code, s.points::int as points,
              (select count(distinct l.user_id)::int from country_points_ledger l
                where l.season_id = s.season_id and l.country_code = s.country_code) as players
            from ${countrySeasonScores} s
            where s.season_id = ${season} and s.points > 0
            order by s.points desc, s.country_code
            limit ${limit}`)
        : await this.db.execute<{ country_code: string; points: number; players: number }>(sql`
            with per_user as (
              select country_code, user_id, sum(points) as pts
              from country_points_ledger where season_id = ${season}
              group by country_code, user_id
            ), ranked as (
              select country_code, pts, row_number() over (partition by country_code order by pts desc) as rn
              from per_user
            )
            select country_code, sum(pts)::int as points, count(*)::int as players
            from ranked where rn <= 50
            group by country_code
            order by points desc, country_code
            limit ${limit}`);

    const data = rows.rows.map((r, i) => ({
      rank: i + 1,
      countryCode: r.country_code,
      points: Number(r.points),
      players: Number(r.players),
    }));
    this.cache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  async players(country: string | undefined, limit: number): Promise<PlayerStanding[]> {
    const rows = await this.db
      .select({ user: users, stats: playerStats })
      .from(playerStats)
      .innerJoin(users, eq(users.id, playerStats.userId))
      .where(and(eq(users.isBot, false), country ? eq(users.countryCode, country) : undefined))
      .orderBy(desc(playerStats.trophies), desc(playerStats.wins), users.createdAt)
      .limit(limit);
    return rows.map(({ user, stats }, i) => ({
      rank: i + 1,
      id: user.id,
      username: user.username,
      countryCode: user.countryCode,
      avatar: user.avatar,
      trophies: stats.trophies,
      league: stats.league as LeagueSlug,
      isBot: user.isBot,
    }));
  }

  /** Pushes the top 10 countries to watchers when the standings changed. */
  async broadcastIfChanged(): Promise<void> {
    const top = await this.countries('total', undefined, 10);
    const serialized = JSON.stringify(top);
    if (serialized === this.lastBroadcast) return;
    this.lastBroadcast = serialized;
    this.realtime.toRoom(LEADERBOARD_ROOM).emit('leaderboard:tick', { countries: top });
  }
}
