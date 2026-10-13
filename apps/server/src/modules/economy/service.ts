import {
  COSMETICS,
  type CosmeticListing,
  findCosmetic,
  isEarnedBy,
  type UnlockProgress,
} from '@swcup/shared';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client';
import { currencyLedger, playerStats, userCosmetics, users } from '../../db/schema';
import { AppError } from '../../lib/errors';

/**
 * Coins and cosmetics. Every coin movement is written to an append-only
 * ledger with an idempotency key, and the balance can never go negative
 * (a CHECK constraint backs up the conditional update).
 */
export class EconomyService {
  constructor(private readonly db: Db) {}

  private async owned(db: DbOrTx, userId: string): Promise<Set<string>> {
    const rows = await db
      .select({ slug: userCosmetics.slug })
      .from(userCosmetics)
      .where(eq(userCosmetics.userId, userId));
    const set = new Set(rows.map((r) => r.slug));
    for (const c of COSMETICS) if (c.unlock.type === 'default') set.add(c.slug);
    return set;
  }

  async list(userId: string): Promise<CosmeticListing[]> {
    const [user] = await this.db
      .select({ avatar: users.avatar, theme: users.theme })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new AppError('unauthorized');
    const owned = await this.owned(this.db, userId);
    return COSMETICS.map((c) => ({
      slug: c.slug,
      kind: c.kind,
      owned: owned.has(c.slug),
      equipped: c.kind === 'avatar' ? user.avatar === c.slug : user.theme === c.slug,
      price: c.unlock.type === 'price' ? c.unlock.value : null,
    }));
  }

  async purchase(userId: string, slug: string): Promise<{ coins: number }> {
    const item = findCosmetic(slug);
    if (!item) throw new AppError('not_found', 'Unknown item');
    if (item.unlock.type !== 'price')
      throw new AppError('not_purchasable', 'This item is earned, not bought');
    const price = item.unlock.value;
    return this.db.transaction(async (tx) => {
      if ((await this.owned(tx, userId)).has(slug)) throw new AppError('already_owned');
      const [updated] = await tx
        .update(playerStats)
        .set({ coins: sql`${playerStats.coins} - ${price}` })
        .where(and(eq(playerStats.userId, userId), gte(playerStats.coins, price)))
        .returning({ coins: playerStats.coins });
      if (!updated) throw new AppError('insufficient_coins', 'Not enough coins');
      await tx.insert(userCosmetics).values({ userId, slug, source: 'purchased' });
      await tx.insert(currencyLedger).values({ userId, delta: -price, reason: 'purchase', refId: slug });
      return { coins: updated.coins };
    });
  }

  async equip(userId: string, slug: string): Promise<void> {
    const item = findCosmetic(slug);
    if (!item) throw new AppError('not_found', 'Unknown item');
    if (!(await this.owned(this.db, userId)).has(slug))
      throw new AppError('not_owned', 'Unlock this item first');
    await this.db
      .update(users)
      .set(item.kind === 'avatar' ? { avatar: slug } : { theme: slug })
      .where(eq(users.id, userId));
  }

  /** Grants every progress-based cosmetic the player now qualifies for; returns new slugs. */
  async grantEarned(db: DbOrTx, userId: string, progress: UnlockProgress): Promise<string[]> {
    const owned = await this.owned(db, userId);
    const earned = COSMETICS.filter(
      (c) =>
        c.unlock.type !== 'default' &&
        c.unlock.type !== 'price' &&
        !owned.has(c.slug) &&
        isEarnedBy(c.unlock, progress),
    ).map((c) => c.slug);
    if (earned.length > 0) {
      await db
        .insert(userCosmetics)
        .values(earned.map((slug) => ({ userId, slug, source: 'earned' })))
        .onConflictDoNothing();
    }
    return earned;
  }
}
