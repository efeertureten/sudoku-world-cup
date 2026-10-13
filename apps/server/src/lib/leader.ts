import type { Logger } from 'pino';
import type { Redis } from '../redis/client';
import { keys } from '../redis/keys';

const LEASE_MS = 6_000;
const RENEW_EVERY_MS = 2_000;

/**
 * Leader election with a Redis lease. Exactly one instance runs the periodic
 * work (timers, matchmaking ticks, leaderboard broadcasts); if it dies, the
 * lease expires and another instance takes over within a few seconds.
 */
export class LeaderElector {
  private timer: NodeJS.Timeout | null = null;
  private leader = false;

  constructor(
    private readonly redis: Redis,
    private readonly instanceId: string,
    private readonly log: Logger,
  ) {}

  get isLeader(): boolean {
    return this.leader;
  }

  async start(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => void this.beat(), RENEW_EVERY_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.leader) await this.redis.swcReleaseLock(keys.leaderLock, this.instanceId).catch(() => undefined);
    this.leader = false;
  }

  private async beat(): Promise<void> {
    try {
      if (this.leader) {
        const renewed = await this.redis.swcRenewLock(keys.leaderLock, this.instanceId, LEASE_MS);
        if (!renewed) {
          this.leader = false;
          this.log.warn('lost leadership');
        }
        return;
      }
      const acquired = await this.redis.set(keys.leaderLock, this.instanceId, 'PX', LEASE_MS, 'NX');
      if (acquired === 'OK') {
        this.leader = true;
        this.log.info({ instance: this.instanceId }, 'became leader');
      }
    } catch (err) {
      this.log.error({ err }, 'leader heartbeat failed');
    }
  }
}
