import { createServer, type Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import express from 'express';
import helmet from 'helmet';
import { Server } from 'socket.io';
import type { Env } from './config/env';
import { createDatabase, type Database, type Db } from './db/client';
import { runMigrations } from './db/migrate';
import { seed } from './db/seed';
import { errorHandler, sessionMiddleware } from './http/middleware';
import { createApiRouter } from './http/routes';
import { LeaderElector } from './lib/leader';
import { createLogger, type Logger } from './lib/logger';
import { TimerWheel } from './lib/timers';
import { AnticheatService } from './modules/anticheat/service';
import { SessionStore } from './modules/auth/session';
import { BotService } from './modules/bot/service';
import { EconomyService } from './modules/economy/service';
import { LeaderboardService } from './modules/leaderboard/service';
import { MatchService } from './modules/match/service';
import { Matchmaker } from './modules/matchmaking/service';
import { PuzzlePool } from './modules/puzzles/pool';
import { SeasonClock } from './modules/seasons/service';
import { TournamentService } from './modules/tournament/service';
import { UserService } from './modules/users/service';
import { createRedis, type Redis } from './redis/client';
import { registerGateway } from './socket/gateway';
import { type GameServer, Realtime } from './socket/realtime';

export interface Services {
  env: Env;
  log: Logger;
  database: Database;
  db: Db;
  redis: Redis;
  sessions: SessionStore;
  seasons: SeasonClock;
  timers: TimerWheel;
  leader: LeaderElector;
  realtime: Realtime;
  users: UserService;
  pool: PuzzlePool;
  economy: EconomyService;
  matches: MatchService;
  bots: BotService;
  matchmaker: Matchmaker;
  tournaments: TournamentService;
  leaderboards: LeaderboardService;
  anticheat: AnticheatService;
}

export interface GameApp {
  services: Services;
  http: HttpServer;
  io: GameServer;
  listen(port: number): Promise<number>;
  stop(): Promise<void>;
}

/** Minimum stock per difficulty created at boot so a fresh install can play immediately. */
const BOOT_POOL_MINIMUM = 15;

/**
 * Composition root: builds every service, wires the HTTP API and the Socket.io
 * gateway, and starts the leader loops. Tests call this with their own env.
 */
export async function createGameApp(env: Env, options: { logger?: Logger } = {}): Promise<GameApp> {
  const log = options.logger ?? createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
  const database = createDatabase(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const pub = redis.duplicate();
  const sub = redis.duplicate();

  if (env.RUN_MIGRATIONS) {
    await runMigrations(database);
    await seed(database.db, log);
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(express.json({ limit: '32kb' }));
  const http = createServer(app);

  const io: GameServer = new Server(http, {
    path: '/socket.io',
    serveClient: false,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    cors: env.NODE_ENV === 'production' ? undefined : { origin: env.PUBLIC_ORIGIN, credentials: true },
    adapter: createAdapter(pub, sub),
  });

  const db = database.db;
  const timers = new TimerWheel(redis, log);
  const realtime = new Realtime(io);
  const seasons = new SeasonClock(db);
  const users = new UserService(db);
  const pool = new PuzzlePool(db, redis, log);
  const economy = new EconomyService(db);
  const matches = new MatchService({ db, redis, log, env, timers, realtime, pool, users, seasons, economy });
  const bots = new BotService({ db, redis, timers, log, matches });
  matches.attachBots(bots);
  const matchmaker = new Matchmaker({ db, redis, env, log, realtime, users, matches });
  const tournaments = new TournamentService({
    db,
    redis,
    env,
    log,
    timers,
    realtime,
    users,
    matches,
    pool,
    seasons,
    economy,
  });
  tournaments.attachMatchmaker(matchmaker);
  const leaderboards = new LeaderboardService(db, seasons, realtime);
  const leader = new LeaderElector(redis, env.INSTANCE_ID, log);

  const services: Services = {
    env,
    log,
    database,
    db,
    redis,
    sessions: new SessionStore(redis),
    seasons,
    timers,
    leader,
    realtime,
    users,
    pool,
    economy,
    matches,
    bots,
    matchmaker,
    tournaments,
    leaderboards,
    anticheat: new AnticheatService(db),
  };

  app.use(sessionMiddleware(services.sessions));
  app.use('/api/v1', createApiRouter(services));
  app.use(errorHandler(log));
  registerGateway(io, services);

  await pool.syncIndex();
  const counts = await pool.counts();
  for (const [difficulty, n] of Object.entries(counts)) {
    if (n < BOOT_POOL_MINIMUM) await pool.generate(difficulty as keyof typeof counts, BOOT_POOL_MINIMUM - n);
  }

  // Leader-only loops. Each guards against overlapping runs.
  const loops: NodeJS.Timeout[] = [];
  const every = (ms: number, fn: () => Promise<unknown>) => {
    let running = false;
    loops.push(
      setInterval(async () => {
        if (!leader.isLeader || running) return;
        running = true;
        try {
          await fn();
        } catch (err) {
          log.error({ err }, 'background loop failed');
        } finally {
          running = false;
        }
      }, ms),
    );
  };
  every(100, () => timers.runDue());
  every(250, () => matchmaker.tick());
  every(5_000, () => leaderboards.broadcastIfChanged());

  return {
    services,
    http,
    io,
    async listen(port: number) {
      await leader.start();
      await new Promise<void>((resolve) => http.listen(port, resolve));
      const address = http.address();
      return typeof address === 'object' && address ? address.port : port;
    },
    async stop() {
      for (const loop of loops) clearInterval(loop);
      await leader.stop();
      io.disconnectSockets(true);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await Promise.allSettled([redis.quit(), pub.quit(), sub.quit()]);
      await database.close();
    },
  };
}
