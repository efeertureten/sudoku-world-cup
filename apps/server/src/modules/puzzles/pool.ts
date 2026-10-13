import { randomInt } from 'node:crypto';
import { type Difficulty as EngineDifficulty, generatePuzzle, serializeGrid } from '@swcup/engine';
import { DIFFICULTIES, type Difficulty } from '@swcup/shared';
import { count, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../../db/client';
import { puzzles } from '../../db/schema';
import type { Redis } from '../../redis/client';
import { keys } from '../../redis/keys';

export type PuzzleRow = typeof puzzles.$inferSelect;

const SEEN_HISTORY = 300;

/**
 * Pre-generated puzzle bank. Generation (especially "hard") takes tens of
 * milliseconds, so matches never wait for it: the worker keeps each
 * difficulty stocked in Postgres and ids are mirrored into Redis sets for
 * O(1) random picks.
 */
export class PuzzlePool {
  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
    private readonly log: Logger,
  ) {}

  async counts(): Promise<Record<Difficulty, number>> {
    const rows = await this.db
      .select({ difficulty: puzzles.difficulty, n: count() })
      .from(puzzles)
      .groupBy(puzzles.difficulty);
    const out = Object.fromEntries(DIFFICULTIES.map((d) => [d, 0])) as Record<Difficulty, number>;
    for (const r of rows) out[r.difficulty] = r.n;
    return out;
  }

  /** Rebuilds the Redis id sets from Postgres (cheap; runs at startup). */
  async syncIndex(): Promise<void> {
    for (const difficulty of DIFFICULTIES) {
      const rows = await this.db
        .select({ id: puzzles.id })
        .from(puzzles)
        .where(eq(puzzles.difficulty, difficulty));
      const key = keys.puzzlePool(difficulty);
      const pipeline = this.redis.pipeline().del(key);
      for (let i = 0; i < rows.length; i += 1000) {
        pipeline.sadd(key, ...rows.slice(i, i + 1000).map((r) => r.id));
      }
      await pipeline.exec();
    }
  }

  async generate(difficulty: Difficulty, amount: number): Promise<number> {
    let created = 0;
    for (let i = 0; i < amount; i++) {
      const seed = randomInt(0, 2 ** 32);
      const puzzle = generatePuzzle(seed, difficulty as EngineDifficulty);
      if (puzzle.grade.difficulty !== difficulty) continue;
      const [row] = await this.db
        .insert(puzzles)
        .values({
          difficulty,
          givens: serializeGrid(puzzle.givens),
          solution: serializeGrid(puzzle.solution),
          givensCount: puzzle.givensCount,
          difficultyScore: puzzle.grade.score,
          hardestTechnique: puzzle.grade.hardest,
          generatorSeed: seed,
          generatorVersion: puzzle.generatorVersion,
        })
        .onConflictDoNothing()
        .returning({ id: puzzles.id });
      if (row) {
        await this.redis.sadd(keys.puzzlePool(difficulty), row.id);
        created++;
      }
      // Yield to the event loop between puzzles so sockets stay responsive.
      await new Promise((r) => setImmediate(r));
    }
    return created;
  }

  /** Tops every difficulty up to `target`. */
  async refill(target: number): Promise<number> {
    const counts = await this.counts();
    let total = 0;
    for (const difficulty of DIFFICULTIES) {
      const missing = target - counts[difficulty];
      if (missing > 0) total += await this.generate(difficulty, missing);
    }
    if (total > 0) this.log.info({ created: total, target }, 'puzzle pool refilled');
    return total;
  }

  /** Picks a puzzle none of `userIds` has seen recently. */
  async pick(difficulty: Difficulty, userIds: string[]): Promise<PuzzleRow> {
    const poolKey = keys.puzzlePool(difficulty);
    let fallback: string | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const id = await this.redis.srandmember(poolKey);
      if (!id) break;
      fallback ??= id;
      const seen = await Promise.all(userIds.map((u) => this.redis.zscore(keys.userSeenPuzzles(u), id)));
      if (seen.every((s) => s === null)) return this.load(Number(id));
    }
    if (fallback) return this.load(Number(fallback));
    // Empty pool (fresh install without the worker): generate on demand.
    await this.generate(difficulty, 1);
    const id = await this.redis.srandmember(poolKey);
    if (!id) throw new Error(`Could not produce a ${difficulty} puzzle`);
    return this.load(Number(id));
  }

  async load(id: number): Promise<PuzzleRow> {
    const [row] = await this.db.select().from(puzzles).where(eq(puzzles.id, id)).limit(1);
    if (!row) throw new Error(`Puzzle ${id} not found`);
    return row;
  }

  async markSeen(userIds: string[], puzzleId: number): Promise<void> {
    const pipeline = this.redis.pipeline();
    const now = Date.now();
    for (const userId of userIds) {
      const key = keys.userSeenPuzzles(userId);
      pipeline
        .zadd(key, now, puzzleId)
        .zremrangebyrank(key, 0, -SEEN_HISTORY - 1)
        .expire(key, 60 * 60 * 24 * 30);
    }
    await pipeline.exec();
  }
}
