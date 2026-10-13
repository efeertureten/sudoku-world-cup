import type { Logger } from 'pino';
import type { Redis } from '../redis/client';
import { keys } from '../redis/keys';

type TimerHandler = (arg: string) => Promise<void>;

/**
 * Durable timer wheel backed by a Redis sorted set (score = due time).
 *
 * Ready checks, countdowns, time limits, reconnect grace periods, bot moves
 * and tournament lobby deadlines are all timers here instead of in-process
 * setTimeouts, so they survive a server restart and any instance (the current
 * leader) can fire them.
 */
export class TimerWheel {
  private readonly handlers = new Map<string, TimerHandler>();

  constructor(
    private readonly redis: Redis,
    private readonly log: Logger,
  ) {}

  on(kind: string, handler: TimerHandler): void {
    this.handlers.set(kind, handler);
  }

  async schedule(kind: string, arg: string, at: number): Promise<void> {
    await this.redis.zadd(keys.timers, at, `${kind}|${arg}`);
  }

  async cancel(kind: string, arg: string): Promise<void> {
    await this.redis.zrem(keys.timers, `${kind}|${arg}`);
  }

  async cancelMany(entries: [kind: string, arg: string][]): Promise<void> {
    if (entries.length === 0) return;
    await this.redis.zrem(keys.timers, ...entries.map(([k, a]) => `${k}|${a}`));
  }

  /** Pops and runs every timer that is due. Returns how many fired. */
  async runDue(now = Date.now(), limit = 200): Promise<number> {
    const due = await this.redis.swcPopDue(keys.timers, now, limit);
    await Promise.all(
      due.map(async (member) => {
        const sep = member.indexOf('|');
        const kind = member.slice(0, sep);
        const arg = member.slice(sep + 1);
        const handler = this.handlers.get(kind);
        if (!handler) {
          this.log.warn({ kind }, 'no handler for timer');
          return;
        }
        try {
          await handler(arg);
        } catch (err) {
          this.log.error({ err, kind, arg }, 'timer handler failed');
        }
      }),
    );
    return due.length;
  }
}
