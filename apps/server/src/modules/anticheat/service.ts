import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { anticheatFlags, countryPointsLedger, countrySeasonScores, users } from '../../db/schema';
import { AppError } from '../../lib/errors';

/**
 * Review queue for flagged matches. Clearing a flag releases the withheld
 * country points; confirming keeps them withheld. Nothing is automatic.
 */
export class AnticheatService {
  constructor(private readonly db: Db) {}

  async list(status: 'open' | 'cleared' | 'confirmed' = 'open', limit = 50) {
    return this.db
      .select({
        id: anticheatFlags.id,
        matchId: anticheatFlags.matchId,
        userId: anticheatFlags.userId,
        username: users.username,
        score: anticheatFlags.score,
        signals: anticheatFlags.signals,
        heldPoints: anticheatFlags.heldPoints,
        status: anticheatFlags.status,
        createdAt: anticheatFlags.createdAt,
      })
      .from(anticheatFlags)
      .innerJoin(users, eq(users.id, anticheatFlags.userId))
      .where(eq(anticheatFlags.status, status))
      .orderBy(desc(anticheatFlags.score), desc(anticheatFlags.createdAt))
      .limit(limit);
  }

  async resolve(id: number, action: 'clear' | 'confirm', note?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [flag] = await tx
        .update(anticheatFlags)
        .set({
          status: action === 'clear' ? 'cleared' : 'confirmed',
          resolvedAt: new Date(),
          resolutionNote: note ?? null,
        })
        .where(and(eq(anticheatFlags.id, id), eq(anticheatFlags.status, 'open')))
        .returning();
      if (!flag) throw new AppError('not_found', 'No open flag with that id');
      if (action !== 'clear' || flag.heldPoints <= 0 || !flag.heldSeasonId || !flag.heldCountryCode) return;
      const [released] = await tx
        .insert(countryPointsLedger)
        .values({
          seasonId: flag.heldSeasonId,
          countryCode: flag.heldCountryCode,
          userId: flag.userId,
          points: flag.heldPoints,
          reason: 'released',
          refId: flag.matchId,
        })
        .onConflictDoNothing()
        .returning({ id: countryPointsLedger.id });
      if (!released) return;
      await tx
        .insert(countrySeasonScores)
        .values({ seasonId: flag.heldSeasonId, countryCode: flag.heldCountryCode, points: flag.heldPoints })
        .onConflictDoUpdate({
          target: [countrySeasonScores.seasonId, countrySeasonScores.countryCode],
          set: { points: sql`${countrySeasonScores.points} + ${flag.heldPoints}` },
        });
    });
  }
}
