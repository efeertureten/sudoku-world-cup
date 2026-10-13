import type { ErrorCode } from './errors';
import type { EmoteInput, MatchIdInput, MoveInput, QueueJoinInput } from './schemas';
import type {
  CountryStanding,
  EmotePayload,
  MatchCountdownPayload,
  MatchEndPayload,
  MatchFoundPayload,
  MatchResumePayload,
  MatchStartPayload,
  MoveAck,
  NoticePayload,
  OpponentConnectionPayload,
  OpponentProgressPayload,
  QueueStatusPayload,
  TournamentState,
} from './types';

/**
 * The Socket.io protocol. Both apps are compiled against these interfaces, so
 * a breaking change fails the build on both sides. docs/PROTOCOL.md documents
 * the same contract for humans.
 */
export type AckResponse<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string };
export type Ack<T> = (response: AckResponse<T>) => void;

type Empty = Record<string, never>;

export interface ClientToServerEvents {
  'queue:join': (payload: QueueJoinInput, ack: Ack<{ queuedAt: number }>) => void;
  'queue:leave': (payload: Empty, ack: Ack<null>) => void;
  'match:ready': (payload: MatchIdInput, ack: Ack<null>) => void;
  'match:move': (payload: MoveInput, ack: Ack<MoveAck>) => void;
  'match:forfeit': (payload: MatchIdInput, ack: Ack<null>) => void;
  'match:emote': (payload: EmoteInput, ack: Ack<null>) => void;
  'tournament:join': (payload: Empty, ack: Ack<TournamentState>) => void;
  'tournament:leave': (payload: Empty, ack: Ack<null>) => void;
  'tournament:watch': (payload: { tournamentId: string }, ack: Ack<TournamentState>) => void;
  'leaderboard:watch': (payload: { on: boolean }, ack: Ack<null>) => void;
  'clock:ping': (payload: { clientTs: number }, ack: Ack<{ clientTs: number; serverTs: number }>) => void;
}

export interface ServerToClientEvents {
  'queue:status': (payload: QueueStatusPayload) => void;
  'match:found': (payload: MatchFoundPayload) => void;
  'match:countdown': (payload: MatchCountdownPayload) => void;
  'match:start': (payload: MatchStartPayload) => void;
  'match:opponent_progress': (payload: OpponentProgressPayload) => void;
  'match:opponent_connection': (payload: OpponentConnectionPayload) => void;
  'match:resume': (payload: MatchResumePayload) => void;
  'match:emote': (payload: EmotePayload) => void;
  'match:end': (payload: MatchEndPayload) => void;
  'tournament:state': (payload: TournamentState) => void;
  'leaderboard:tick': (payload: { countries: CountryStanding[] }) => void;
  notice: (payload: NoticePayload) => void;
}
