import { type Difficulty, GAME_RULES } from '@swcup/shared';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../../db/client';
import type { TimerWheel } from '../../lib/timers';
import type { Redis } from '../../redis/client';
import { keys, MATCH_TTL_SECONDS } from '../../redis/keys';
import type { MatchService } from '../match/service';
import type { CompetitiveProfile } from '../users/service';
import { botParamsFor, decideNextMove, humanJitter } from './brain';

/**
 * Runs bots as stateless timer callbacks: every step reads the bot's board
 * from Redis, plays the move it planned last time through the same
 * validation path as humans, then plans and schedules the next one.
 */
export class BotService {
  constructor(
    private readonly deps: {
      db: Db;
      redis: Redis;
      timers: TimerWheel;
      log: Logger;
      matches: MatchService;
    },
  ) {
    deps.timers.on('bot', (arg) => {
      const [matchId, botId] = arg.split(':') as [string, string];
      return this.step(matchId, botId);
    });
  }

  /** Average ms per solved cell for the human's recent completed games on this difficulty. */
  private async humanPace(userId: string, difficulty: Difficulty): Promise<number | null> {
    const result = await this.deps.db.execute<{ pace: number | null; n: number }>(sql`
      select avg(pace)::float as pace, count(*)::int as n from (
        select mp.finish_time_ms::float / greatest(1, 81 - p.givens_count) as pace
        from match_participants mp
        join matches m on m.id = mp.match_id
        join puzzles p on p.id = m.puzzle_id
        where mp.user_id = ${userId} and m.difficulty = ${difficulty} and mp.finish_time_ms is not null
        order by mp.ended_at desc
        limit 10
      ) recent`);
    const row = result.rows[0];
    return row && row.n >= 3 && row.pace ? row.pace : null;
  }

  async prepare(matchId: string, bot: CompetitiveProfile, humanId: string | null, difficulty: Difficulty) {
    const pace = humanId ? await this.humanPace(humanId, difficulty) : null;
    const params = botParamsFor(bot.rating, difficulty, pace, Math.random);
    const key = keys.matchBot(matchId, bot.id);
    await this.deps.redis
      .multi()
      .hset(key, { msPerCell: params.msPerCell, errorRate: params.errorRate, seq: 0, lastCell: -1 })
      .expire(key, MATCH_TTL_SECONDS)
      .exec();
  }

  /** Called when the match starts: the bot "scans the board" before its first move. */
  async begin(matchId: string, botId: string): Promise<void> {
    await this.plan(matchId, botId, 2_000 + Math.random() * 3_000);
  }

  private async plan(matchId: string, botId: string, extraDelayMs = 0): Promise<void> {
    const { redis, timers, matches } = this.deps;
    const meta = await matches.getMeta(matchId);
    if (meta?.status !== 'in_progress') return;
    const state = await matches.getPlayerState(matchId, botId);
    const bot = await redis.hgetall(keys.matchBot(matchId, botId));
    if (!bot.msPerCell) return;
    const decision = decideNextMove({
      board: Uint8Array.from(state.board, (ch) => Number(ch)),
      solution: meta.solution,
      lastCell: Number(bot.lastCell) >= 0 ? Number(bot.lastCell) : null,
      params: { msPerCell: Number(bot.msPerCell), errorRate: Number(bot.errorRate) },
      mistakes: state.mistakes,
      maxMistakes: GAME_RULES.maxMistakes,
      random: Math.random,
    });
    if (!decision) return;
    const now = Date.now();
    const at = Math.max(now, state.lockedUntil) + extraDelayMs + decision.thinkMs;
    await redis.hset(
      keys.matchBot(matchId, botId),
      'pendingCell',
      decision.cell,
      'pendingValue',
      decision.value,
    );
    await timers.schedule('bot', `${matchId}:${botId}`, at);
  }

  async step(matchId: string, botId: string): Promise<void> {
    const { redis, matches } = this.deps;
    const key = keys.matchBot(matchId, botId);
    const bot = await redis.hgetall(key);
    if (!bot.pendingCell) return;
    const seq = await redis.hincrby(key, 'seq', 1);
    const ack = await matches.applyMove(
      matchId,
      botId,
      Number(bot.pendingCell),
      Number(bot.pendingValue),
      seq,
    );
    await redis.hset(key, 'lastCell', bot.pendingCell);
    await redis.hdel(key, 'pendingCell', 'pendingValue');
    if (ack.completed) return;
    if (ack.verdict === 'rejected') {
      if (ack.reason === 'locked') {
        await this.plan(matchId, botId);
      } else if (
        ack.reason === 'not_in_progress' ||
        ack.reason === 'time_up' ||
        ack.reason === 'not_in_match'
      ) {
        return;
      } else {
        await this.plan(matchId, botId, 500);
      }
      return;
    }
    // After a mistake a person pauses, annoyed, before carrying on.
    const recovery = ack.verdict === 'wrong' ? 1_000 * humanJitter(Math.random) : 0;
    await this.plan(matchId, botId, recovery);
  }
}
