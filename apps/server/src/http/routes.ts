import { timingSafeEqual } from 'node:crypto';
import {
  AVATARS,
  BOARD_THEMES,
  COUNTRY_CODES,
  countryLeaderboardQuery,
  guestInput,
  historyQuery,
  LEAGUES,
  loginInput,
  type MetaPayload,
  playerLeaderboardQuery,
  registerInput,
  updateMeInput,
} from '@swcup/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../app';
import { AppError } from '../lib/errors';
import { clearedSessionCookie, sessionCookie } from '../modules/auth/session';
import { getMatchDetail } from '../modules/matches/query';
import { toSeasonInfo } from '../modules/seasons/service';
import { parse, rateLimit, requireUser } from './middleware';

export function createApiRouter(s: Services): Router {
  const { env, sessions, users, redis } = s;
  const router = Router();

  // ------------------------------------------------------------------ health

  router.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/readyz', async (_req, res) => {
    await s.database.pool.query('select 1');
    await redis.ping();
    res.json({ ok: true, leader: s.leader.isLeader });
  });

  // -------------------------------------------------------------------- meta

  router.get('/meta', async (_req, res) => {
    const season = await s.seasons.get();
    const payload: MetaPayload = {
      countries: [...COUNTRY_CODES],
      leagues: LEAGUES,
      season: toSeasonInfo(season),
      tunables: {
        botFallbackMs: env.BOT_FALLBACK_MS,
        matchTimeLimitMs: env.MATCH_TIME_LIMIT_MS,
        tournamentFillMs: env.TOURNAMENT_FILL_MS,
      },
      themes: BOARD_THEMES,
      avatars: AVATARS,
    };
    res.set('Cache-Control', 'public, max-age=60').json(payload);
  });

  // -------------------------------------------------------------------- auth

  const startSession = async (res: import('express').Response, userId: string, previous?: string) => {
    await sessions.destroy(previous);
    const sid = await sessions.create(userId);
    res.setHeader('Set-Cookie', sessionCookie(sid, env.COOKIE_SECURE));
  };

  router.post('/auth/guest', rateLimit(redis, 'guest', 10, 60_000), async (req, res) => {
    const input = parse(guestInput, req.body);
    const userId = await users.createGuest(input);
    await startSession(res, userId, req.sessionId);
    res.status(201).json(await users.getMe(userId));
  });

  router.post('/auth/register', rateLimit(redis, 'register', 10, 60_000), async (req, res) => {
    const input = parse(registerInput, req.body);
    const userId = await users.register(req.userId ?? null, input);
    await startSession(res, userId, req.sessionId);
    res.status(201).json(await users.getMe(userId));
  });

  router.post('/auth/login', rateLimit(redis, 'login', 10, 60_000), async (req, res) => {
    const input = parse(loginInput, req.body);
    const userId = await users.login(input);
    await startSession(res, userId, req.sessionId);
    res.json(await users.getMe(userId));
  });

  router.post('/auth/logout', async (req, res) => {
    if (req.userId) {
      await s.matchmaker.leave(req.userId);
      await sessions.destroy(req.sessionId);
    }
    res.setHeader('Set-Cookie', clearedSessionCookie(env.COOKIE_SECURE));
    res.status(204).end();
  });

  router.get('/auth/me', async (req, res) => {
    res.json(await users.getMe(requireUser(req)));
  });

  // ------------------------------------------------------------------- users

  router.get('/users/:username', async (req, res) => {
    res.json(await users.getProfile(String(req.params.username)));
  });

  router.get('/users/:username/matches', async (req, res) => {
    const q = parse(historyQuery, req.query);
    const userId = await users.findIdByUsername(String(req.params.username));
    res.json(await users.getHistory(userId, q.limit, q.before ? new Date(q.before) : undefined));
  });

  router.patch('/users/me', async (req, res) => {
    const userId = requireUser(req);
    const input = parse(updateMeInput, req.body);
    if (input.countryCode) await users.updateCountry(userId, input.countryCode);
    res.json(await users.getMe(userId));
  });

  // ----------------------------------------------------------------- matches

  router.get('/matches/:id', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    res.json(await getMatchDetail(s.db, id));
  });

  // ------------------------------------------------------------ leaderboards

  router.get('/leaderboards/countries', async (req, res) => {
    const q = parse(countryLeaderboardQuery, req.query);
    res.json(await s.leaderboards.countries(q.metric, q.season));
  });

  router.get('/leaderboards/players', async (req, res) => {
    const q = parse(playerLeaderboardQuery, req.query);
    res.json(await s.leaderboards.players(q.country, q.limit));
  });

  // ------------------------------------------------------------- tournaments

  router.get('/tournaments', async (_req, res) => {
    res.json({ current: await s.tournaments.current(), recent: await s.tournaments.recent() });
  });

  router.get('/tournaments/:id', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    res.json(await s.tournaments.get(id));
  });

  // --------------------------------------------------------------- cosmetics

  router.get('/cosmetics', async (req, res) => {
    res.json(await s.economy.list(requireUser(req)));
  });

  router.post('/cosmetics/:slug/purchase', async (req, res) => {
    const userId = requireUser(req);
    await s.economy.purchase(userId, String(req.params.slug));
    res.json(await users.getMe(userId));
  });

  router.post('/cosmetics/:slug/equip', async (req, res) => {
    const userId = requireUser(req);
    await s.economy.equip(userId, String(req.params.slug));
    res.json(await users.getMe(userId));
  });

  // ------------------------------------------------------------------- admin

  const expected = Buffer.from(`Bearer ${env.ADMIN_TOKEN}`);
  const requireAdmin = (req: import('express').Request) => {
    const given = Buffer.from(req.headers.authorization ?? '');
    const ok = env.ADMIN_TOKEN !== '' && given.length === expected.length && timingSafeEqual(given, expected);
    if (!ok) throw new AppError('forbidden', 'Admin only');
  };

  router.get('/admin/flags', async (req, res) => {
    requireAdmin(req);
    const status = parse(z.enum(['open', 'cleared', 'confirmed']).default('open'), req.query.status);
    res.json(await s.anticheat.list(status));
  });

  router.post('/admin/flags/:id/resolve', async (req, res) => {
    requireAdmin(req);
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const body = parse(
      z.object({ action: z.enum(['clear', 'confirm']), note: z.string().max(500).optional() }),
      req.body,
    );
    await s.anticheat.resolve(id, body.action, body.note);
    res.status(204).end();
  });

  router.use(() => {
    throw new AppError('not_found', 'No such endpoint');
  });

  return router;
}
