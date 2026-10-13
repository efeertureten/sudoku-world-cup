import {
  type AckResponse,
  clockPingInput,
  emoteInput,
  emptyInput,
  leaderboardWatchInput,
  matchIdInput,
  moveInput,
  queueJoinInput,
  tournamentWatchInput,
} from '@swcup/shared';
import type { Logger } from 'pino';
import type { Socket } from 'socket.io';
import type { ZodType, z } from 'zod';
import type { Services } from '../app';
import { AppError } from '../lib/errors';
import { parseCookies, SESSION_COOKIE } from '../modules/auth/session';
import { type GameServer, LEADERBOARD_ROOM, userRoom } from './realtime';

type GameSocket = Parameters<Parameters<GameServer['on']>[1]>[0];

/**
 * Registers a validated, acknowledged event handler. Every client event
 * carries an ack callback and gets exactly one `{ ok, data | code }` reply.
 */
function handle<S extends ZodType, R>(
  socket: GameSocket,
  log: Logger,
  event: string,
  schema: S,
  fn: (input: z.output<S>) => Promise<R>,
): void {
  (socket as unknown as Socket).on(event, async (payload: unknown, ack?: (res: AckResponse<R>) => void) => {
    if (typeof ack !== 'function') return;
    const parsed = schema.safeParse(payload ?? {});
    if (!parsed.success) {
      ack({ ok: false, code: 'bad_request', message: parsed.error.issues[0]?.message ?? 'Invalid payload' });
      return;
    }
    try {
      ack({ ok: true, data: await fn(parsed.data) });
    } catch (err) {
      if (err instanceof AppError) {
        ack({ ok: false, code: err.code, message: err.message });
      } else {
        log.error({ err, event }, 'socket handler failed');
        ack({ ok: false, code: 'internal', message: 'Something went wrong on our side' });
      }
    }
  });
}

export function registerGateway(io: GameServer, s: Services): void {
  const { log } = s;

  // The same session cookie that authenticates REST calls authenticates the socket.
  io.use(async (socket, next) => {
    try {
      const sid = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
      const userId = await s.sessions.resolve(sid);
      if (!userId) return next(new Error('unauthorized'));
      socket.data.userId = userId;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.data.userId;
    await socket.join(userRoom(userId));

    handle(socket, log, 'clock:ping', clockPingInput, async ({ clientTs }) => ({
      clientTs,
      serverTs: Date.now(),
    }));

    handle(socket, log, 'queue:join', queueJoinInput, ({ mode, difficulty }) =>
      s.matchmaker.join(userId, mode, difficulty),
    );
    handle(socket, log, 'queue:leave', emptyInput, async () => {
      await s.matchmaker.leave(userId);
      return null;
    });

    handle(socket, log, 'match:ready', matchIdInput, async ({ matchId }) => {
      await s.matches.markReady(matchId, userId);
      return null;
    });
    handle(socket, log, 'match:move', moveInput, ({ matchId, seq, cell, value }) =>
      s.matches.applyMove(matchId, userId, cell, value, seq),
    );
    handle(socket, log, 'match:forfeit', matchIdInput, async ({ matchId }) => {
      await s.matches.forfeit(matchId, userId);
      return null;
    });
    handle(socket, log, 'match:emote', emoteInput, async ({ matchId, emoteId }) => {
      await s.matches.emote(matchId, userId, emoteId);
      return null;
    });

    handle(socket, log, 'tournament:join', emptyInput, () => s.tournaments.join(userId));
    handle(socket, log, 'tournament:leave', emptyInput, async () => {
      await s.tournaments.leave(userId);
      return null;
    });
    handle(socket, log, 'tournament:watch', tournamentWatchInput, ({ tournamentId }) =>
      s.tournaments.watch(userId, tournamentId),
    );

    handle(socket, log, 'leaderboard:watch', leaderboardWatchInput, async ({ on }) => {
      if (on) await socket.join(LEADERBOARD_ROOM);
      else await socket.leave(LEADERBOARD_ROOM);
      return null;
    });

    socket.on('disconnect', async () => {
      try {
        const remaining = await io.in(userRoom(userId)).fetchSockets();
        if (remaining.length > 0) return;
        await s.matchmaker.leave(userId);
        await s.matches.handleDisconnect(userId);
      } catch (err) {
        log.error({ err, userId }, 'disconnect handling failed');
      }
    });

    // Restore whatever the player was doing before this connection.
    try {
      await s.matches.handleReconnect(userId);
      await s.tournaments.handleReconnect(userId);
      void s.users.touch(userId);
    } catch (err) {
      log.error({ err, userId }, 'reconnect handling failed');
    }
  });
}
