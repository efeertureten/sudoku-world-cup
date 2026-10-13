import type { MatchDetail } from '@swcup/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameApp } from '../src/app';
import {
  anticheatFlags,
  countryPointsLedger,
  matches,
  matchParticipants,
  playerStats,
} from '../src/db/schema';
import { BOT_COUNTRY_POINTS_DAILY_CAP } from '../src/modules/rating/rewards';
import { keys } from '../src/redis/keys';
import {
  type ClientSocket,
  call,
  createGuest,
  infrastructureAvailable,
  next,
  openSocket,
  sleep,
  startTestApp,
  TEST_ADMIN_TOKEN,
  uniqueName,
} from './helpers';

const available = await infrastructureAvailable();

/**
 * End-to-end tests against real Postgres and Redis (see CONTRIBUTING.md:
 * `pnpm infra:up`). They drive the server exactly like the web client does.
 */
describe.runIf(available)('game server (integration)', () => {
  let app: GameApp;
  let url: string;
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    ({ app, url } = await startTestApp());
  }, 60_000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await app?.stop();
  });

  const player = async (prefix: string, country = 'TR') => {
    const guest = await createGuest(url, uniqueName(prefix), country);
    const socket = await openSocket(url, guest.cookie);
    sockets.push(socket);
    return { ...guest, socket };
  };

  it('rejects sockets without a session', async () => {
    const { io } = await import('socket.io-client');
    const socket = io(url, { path: '/socket.io', transports: ['websocket'], reconnection: false });
    const error = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
    expect(error.message).toBe('unauthorized');
    socket.disconnect();
  });

  it('plays a full ranked match between two people', async () => {
    const a = await player('alice', 'TR');
    const b = await player('bruno', 'BR');

    const foundA = next(a.socket, 'match:found');
    const foundB = next(b.socket, 'match:found');
    await call(a.socket, 'queue:join', { mode: 'ranked' });
    await call(b.socket, 'queue:join', { mode: 'ranked' });
    const [fa, fb] = await Promise.all([foundA, foundB]);
    expect(fa.matchId).toBe(fb.matchId);
    expect(fa.opponent.id).toBe(b.id);
    expect(fa.opponent.isBot).toBe(false);
    const matchId = fa.matchId;

    const startA = next(a.socket, 'match:start');
    const startB = next(b.socket, 'match:start');
    const countdown = next(a.socket, 'match:countdown');
    await call(a.socket, 'match:ready', { matchId });
    await call(b.socket, 'match:ready', { matchId });
    expect((await countdown).startsAt).toBeGreaterThan(Date.now() - 100);
    const [start] = await Promise.all([startA, startB]);
    expect(start.givens).toHaveLength(81);
    expect(start).not.toHaveProperty('solution');

    // The test reads the solution straight from Redis; clients never receive it.
    const solution = (await app.services.redis.hget(keys.match(matchId), 'solution'))!;
    const empties = [...start.givens].flatMap((ch, i) => (ch === '0' ? [i] : []));

    let seq = 0;
    const firstEmpty = empties[0]!;
    const wrongValue = (Number(solution[firstEmpty]) % 9) + 1;
    const progressOnB = next(b.socket, 'match:opponent_progress');
    const wrong = await call(a.socket, 'match:move', {
      matchId,
      seq: ++seq,
      cell: firstEmpty,
      value: wrongValue,
    });
    expect(wrong.verdict).toBe('wrong');
    expect(wrong.mistakes).toBe(1);
    expect(wrong.lockedUntil).toBeGreaterThan(Date.now());
    expect((await progressOnB).mistakes).toBe(1);

    const locked = await call(a.socket, 'match:move', {
      matchId,
      seq: ++seq,
      cell: firstEmpty,
      value: Number(solution[firstEmpty]),
    });
    expect(locked).toMatchObject({ verdict: 'rejected', reason: 'locked' });

    const given = start.givens.indexOf(start.givens.match(/[1-9]/)![0]);
    await sleep(3_100);
    const onGiven = await call(a.socket, 'match:move', { matchId, seq: ++seq, cell: given, value: 1 });
    expect(onGiven).toMatchObject({ verdict: 'rejected', reason: 'given' });

    // Replaying an already-acknowledged seq returns the same answer (idempotent retries).
    const firstCorrect = await call(a.socket, 'match:move', {
      matchId,
      seq: ++seq,
      cell: firstEmpty,
      value: Number(solution[firstEmpty]),
    });
    expect(firstCorrect.verdict).toBe('correct');
    const replay = await call(a.socket, 'match:move', {
      matchId,
      seq,
      cell: firstEmpty,
      value: Number(solution[firstEmpty]),
    });
    expect(replay).toEqual(firstCorrect);

    const endA = next(a.socket, 'match:end', 60_000);
    const endB = next(b.socket, 'match:end', 60_000);
    let last = firstCorrect;
    for (const cell of empties.slice(1)) {
      // Stay well under the 8 moves/second limit: the window also counts the moves made just before.
      await sleep(170);
      last = await call(a.socket, 'match:move', { matchId, seq: ++seq, cell, value: Number(solution[cell]) });
      expect(last.verdict, JSON.stringify(last)).toBe('correct');
    }
    expect(last.completed).toBe(true);

    const [end, endOnB] = await Promise.all([endA, endB]);
    expect(end.winnerId).toBe(a.id);
    expect(end.reason).toBe('completed');
    expect(end.solution).toBe(solution);
    expect(endOnB.winnerId).toBe(a.id);
    const mine = end.results.find((r) => r.userId === a.id)!;
    expect(mine.result).toBe('win');
    expect(mine.trophiesDelta).toBeGreaterThan(0);
    expect(mine.coins).toBeGreaterThan(0);

    const db = app.services.db;
    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row?.winnerId).toBe(a.id);
    const parts = await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId));
    expect(parts).toHaveLength(2);
    const [stats] = await db.select().from(playerStats).where(eq(playerStats.userId, a.id));
    expect(stats?.wins).toBe(1);
    expect(stats?.trophies).toBe(mine.trophiesAfter);

    // Index-order, fixed-pace filling is exactly what the anti-cheat looks for.
    const flags = await db.select().from(anticheatFlags).where(eq(anticheatFlags.matchId, matchId));
    expect(flags).toHaveLength(1);
    expect(flags[0]?.userId).toBe(a.id);
    expect(flags[0]?.heldPoints).toBe(mine.countryPoints);

    // Finished matches are public and verifiable.
    const detail = (await fetch(`${url}/api/v1/matches/${matchId}`).then((r) => r.json())) as MatchDetail;
    expect(detail.generatorSeed).toBe(end.generatorSeed);
    expect(detail.participants).toHaveLength(2);
  }, 90_000);

  it('falls back to a bot opponent and lets the player resume after reconnecting', async () => {
    const c = await player('carla', 'IT');
    const found = next(c.socket, 'match:found');
    await call(c.socket, 'queue:join', { mode: 'casual', difficulty: 'easy' });
    const match = await found;
    expect(match.opponent.isBot).toBe(true);
    expect(match.type).toBe('casual');

    const started = next(c.socket, 'match:start');
    await call(c.socket, 'match:ready', { matchId: match.matchId });
    await started;

    // The bot plays through the same validation path and its progress is broadcast.
    const botProgress = await next(c.socket, 'match:opponent_progress', 30_000);
    expect(botProgress.filled + botProgress.mistakes).toBeGreaterThan(0);

    c.socket.disconnect();
    await sleep(200);
    const reconnected = await openSocket(url, c.cookie);
    sockets.push(reconnected);
    const resume = await next(reconnected, 'match:resume');
    expect(resume.matchId).toBe(match.matchId);
    expect(resume.status).toBe('in_progress');
    expect(resume.board).toHaveLength(81);
    expect(resume.opponent.isBot).toBe(true);

    const end = next(reconnected, 'match:end');
    await call(reconnected, 'match:forfeit', { matchId: match.matchId });
    const result = await end;
    expect(result.reason).toBe('forfeit');
    expect(result.winnerId).toBe(match.opponent.id);
  }, 60_000);

  it('caps country points from bot wins and releases held points after review', async () => {
    const e = await player('erik', 'NZ');
    const season = await app.services.seasons.get();
    // Pretend Erik already earned almost a full day's worth of bot points.
    await app.services.db.insert(countryPointsLedger).values({
      seasonId: season.id,
      countryCode: 'NZ',
      userId: e.id,
      points: BOT_COUNTRY_POINTS_DAILY_CAP - 1,
      reason: 'ranked_bot',
      refId: 'earlier-today',
    });

    const found = next(e.socket, 'match:found');
    await call(e.socket, 'queue:join', { mode: 'ranked' });
    const match = await found;
    expect(match.opponent.isBot).toBe(true);
    const started = next(e.socket, 'match:start');
    await call(e.socket, 'match:ready', { matchId: match.matchId });
    const start = await started;
    const solution = (await app.services.redis.hget(keys.match(match.matchId), 'solution'))!;

    const ended = next(e.socket, 'match:end', 60_000);
    let seq = 0;
    for (const [cell, ch] of [...start.givens].entries()) {
      if (ch !== '0') continue;
      await call(e.socket, 'match:move', {
        matchId: match.matchId,
        seq: ++seq,
        cell,
        value: Number(solution[cell]),
      });
      await sleep(170);
    }
    const end = await ended;
    const mine = end.results.find((r) => r.userId === e.id)!;
    expect(mine.result).toBe('win');
    expect(mine.countryPoints).toBe(1);

    // Scripted play is flagged, so the point is held until a reviewer clears it.
    const headers = { authorization: `Bearer ${TEST_ADMIN_TOKEN}`, 'content-type': 'application/json' };
    expect((await fetch(`${url}/api/v1/admin/flags`)).status).toBe(403);
    const flags = (await fetch(`${url}/api/v1/admin/flags`, { headers }).then((r) => r.json())) as {
      id: number;
      matchId: string;
      heldPoints: number;
    }[];
    const flag = flags.find((f) => f.matchId === match.matchId)!;
    expect(flag.heldPoints).toBe(1);
    const resolved = await fetch(`${url}/api/v1/admin/flags/${flag.id}/resolve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'clear', note: 'test' }),
    });
    expect(resolved.status).toBe(204);
    // The test database outlives runs, so check this player's ledger rather than the country total.
    const ledger = await app.services.db
      .select({ points: countryPointsLedger.points })
      .from(countryPointsLedger)
      .where(eq(countryPointsLedger.userId, e.id));
    expect(ledger.reduce((sum, row) => sum + row.points, 0)).toBe(BOT_COUNTRY_POINTS_DAILY_CAP);
    const standings = (await fetch(`${url}/api/v1/leaderboards/countries?metric=top50`).then((r) =>
      r.json(),
    )) as { countryCode: string; points: number }[];
    expect(standings.find((c) => c.countryCode === 'NZ')?.points).toBeGreaterThanOrEqual(
      BOT_COUNTRY_POINTS_DAILY_CAP,
    );
  }, 90_000);

  it('runs a 16-player cup with bots filling the empty seats', async () => {
    const d = await player('dana', 'KE');
    const runningBroadcast = next(d.socket, 'tournament:state', 20_000, (s) => s.status === 'running');
    const foundPromise = next(d.socket, 'match:found', 20_000);
    const state = await call(d.socket, 'tournament:join', {});
    expect(state.status).toBe('lobby');
    expect(state.players.map((p) => p.userId)).toContain(d.id);

    const found = await foundPromise;
    expect(found.type).toBe('tournament');
    expect(found.tournament?.round).toBe(0);
    const running = await runningBroadcast;
    expect(running.id).toBe(found.tournament!.id);
    expect(running.players).toHaveLength(16);
    expect(running.rounds[0]!.filter((m) => m.simulated)).toHaveLength(7);
    const watched = await call(d.socket, 'tournament:watch', { tournamentId: running.id });
    expect(watched.status).toBe('running');

    const finished = next(d.socket, 'tournament:state', 30_000, (s) => s.status === 'finished');
    await call(d.socket, 'match:forfeit', { matchId: found.matchId });
    const final = await finished;
    expect(final.championId).toBeTruthy();
    expect(final.championId).not.toBe(d.id);
    expect(final.rounds[3]![0]!.status).toBe('finished');
  }, 60_000);

  it('serves leaderboards and the public profile', async () => {
    const res = await fetch(`${url}/api/v1/leaderboards/players?limit=5`);
    expect(res.status).toBe(200);
    const players = (await res.json()) as { isBot: boolean }[];
    expect(players.every((p) => !p.isBot)).toBe(true);
    const countries = await fetch(`${url}/api/v1/leaderboards/countries?metric=top50`);
    expect(countries.status).toBe(200);
  });
});
