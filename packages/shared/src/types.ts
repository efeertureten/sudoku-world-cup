import type { Avatar, BoardTheme } from './cosmetics';
import type { League, LeagueSlug } from './leagues';
import type { Difficulty, EmoteId, MatchEndReason, MatchType, QueueMode } from './rules';

/** Data transfer objects exchanged over REST and Socket.io. */

export interface PublicPlayer {
  id: string;
  username: string;
  countryCode: string;
  avatar: string;
  isBot: boolean;
  trophies: number;
  league: LeagueSlug;
}

export interface MeProfile extends PublicPlayer {
  isGuest: boolean;
  email: string | null;
  theme: string;
  coins: number;
  wins: number;
  losses: number;
  winStreak: number;
  bestTimeMs: number | null;
  tournamentWins: number;
  ownedCosmetics: string[];
  /** ISO timestamp when the country can be changed again, or null if it can be changed now. */
  countryChangeAvailableAt: string | null;
  createdAt: string;
}

export interface PlayerProfile extends PublicPlayer {
  wins: number;
  losses: number;
  winStreak: number;
  bestTimeMs: number | null;
  tournamentWins: number;
  createdAt: string;
  recentMatches: MatchHistoryEntry[];
}

export interface MatchHistoryEntry {
  matchId: string;
  type: MatchType;
  difficulty: Difficulty;
  endedAt: string;
  result: 'win' | 'loss' | 'draw';
  reason: MatchEndReason;
  finishTimeMs: number | null;
  mistakes: number;
  trophiesDelta: number;
  opponent: { username: string; countryCode: string; isBot: boolean };
}

export interface TournamentRef {
  id: string;
  round: number;
}

export interface MatchFoundPayload {
  matchId: string;
  type: MatchType;
  difficulty: Difficulty;
  you: PublicPlayer;
  opponent: PublicPlayer;
  readyDeadline: number;
  tournament?: TournamentRef;
}

export interface MatchCountdownPayload {
  matchId: string;
  startsAt: number;
  serverNow: number;
}

export interface MatchStartPayload {
  matchId: string;
  /** 81 characters, '0' for empty cells. The solution never leaves the server during a match. */
  givens: string;
  difficulty: Difficulty;
  startedAt: number;
  endsAt: number;
  serverNow: number;
  totalEmpty: number;
}

export type MoveVerdict = 'correct' | 'wrong' | 'rejected';
export type MoveRejectReason =
  | 'not_in_progress'
  | 'not_in_match'
  | 'locked'
  | 'filled'
  | 'given'
  | 'stale'
  | 'rate_limited'
  | 'time_up';

export interface MoveAck {
  seq: number;
  cell: number;
  value: number;
  verdict: MoveVerdict;
  reason?: MoveRejectReason;
  mistakes: number;
  /** Epoch ms until which input is frozen (0 when not locked). */
  lockedUntil: number;
  filled: number;
  completed: boolean;
}

export interface OpponentProgressPayload {
  matchId: string;
  filled: number;
  totalEmpty: number;
  mistakes: number;
  /** Which cell the opponent just solved. Values are never revealed. */
  cell?: number;
  lockedUntil?: number;
}

export interface OpponentConnectionPayload {
  matchId: string;
  connected: boolean;
  graceEndsAt?: number;
}

export type LiveMatchStatus = 'ready_check' | 'countdown' | 'in_progress';

export interface MatchResumePayload {
  matchId: string;
  type: MatchType;
  status: LiveMatchStatus;
  difficulty: Difficulty;
  you: PublicPlayer;
  opponent: PublicPlayer;
  serverNow: number;
  readyDeadline?: number;
  startsAt?: number;
  startedAt?: number;
  endsAt?: number;
  givens?: string;
  /** Your board: givens plus the cells you solved, '0' for empty. */
  board?: string;
  totalEmpty: number;
  filled: number;
  mistakes: number;
  lockedUntil: number;
  lastSeq: number;
  opponentProgress: { filled: number; mistakes: number; connected: boolean };
  tournament?: TournamentRef;
}

export interface MatchResultEntry {
  userId: string;
  username: string;
  countryCode: string;
  avatar: string;
  isBot: boolean;
  result: 'win' | 'loss' | 'draw';
  finishTimeMs: number | null;
  mistakes: number;
  filled: number;
  trophiesDelta: number;
  trophiesAfter: number;
  countryPoints: number;
  coins: number;
  unlocks: string[];
}

export interface MatchEndPayload {
  matchId: string;
  type: MatchType;
  difficulty: Difficulty;
  winnerId: string | null;
  reason: MatchEndReason;
  results: MatchResultEntry[];
  givens: string;
  solution: string;
  puzzleId: number;
  generatorSeed: number;
  totalEmpty: number;
  tournament?: TournamentRef & { eliminated: boolean; champion: boolean };
}

export interface MatchDetail {
  matchId: string;
  type: MatchType;
  difficulty: Difficulty;
  reason: MatchEndReason;
  winnerId: string | null;
  startedAt: string;
  endedAt: string;
  givens: string;
  solution: string;
  puzzleId: number;
  generatorSeed: number;
  generatorVersion: number;
  participants: (MatchResultEntry & { moves: { cell: number; value: number; ok: boolean; t: number }[] })[];
}

export interface EmotePayload {
  matchId: string;
  from: string;
  emoteId: EmoteId;
}

export interface QueueStatusPayload {
  mode: QueueMode;
  elapsedMs: number;
  searchRange: number;
  botInMs: number;
}

export interface TournamentPlayer {
  userId: string;
  username: string;
  countryCode: string;
  avatar: string;
  isBot: boolean;
  trophies: number;
}

export interface BracketMatch {
  round: number;
  slot: number;
  a: string | null;
  b: string | null;
  winner: string | null;
  matchId: string | null;
  status: 'pending' | 'live' | 'finished';
  /** Bot-vs-bot ties are resolved by simulation instead of a live match. */
  simulated: boolean;
}

export interface TournamentState {
  id: string;
  status: 'lobby' | 'running' | 'finished';
  size: number;
  players: TournamentPlayer[];
  fillAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  rounds: BracketMatch[][];
  championId: string | null;
  serverNow: number;
}

export interface TournamentSummary {
  id: string;
  status: TournamentState['status'];
  startedAt: string | null;
  finishedAt: string | null;
  champion: { username: string; countryCode: string; isBot: boolean } | null;
  humanPlayers: number;
}

export interface CountryStanding {
  rank: number;
  countryCode: string;
  points: number;
  players: number;
}

export interface PlayerStanding {
  rank: number;
  id: string;
  username: string;
  countryCode: string;
  avatar: string;
  trophies: number;
  league: LeagueSlug;
  isBot: boolean;
}

export interface SeasonInfo {
  id: number;
  /** 1-based season number, for localized labels ("Sezon 3"). */
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
}

export interface ServerTunables {
  botFallbackMs: number;
  matchTimeLimitMs: number;
  tournamentFillMs: number;
}

export interface MetaPayload {
  countries: string[];
  leagues: readonly League[];
  season: SeasonInfo;
  tunables: ServerTunables;
  themes: readonly BoardTheme[];
  avatars: readonly Avatar[];
}

export interface CosmeticListing {
  slug: string;
  kind: 'board_theme' | 'avatar';
  owned: boolean;
  equipped: boolean;
  /** Price in coins when the item can be bought, otherwise null. */
  price: number | null;
}

export interface NoticePayload {
  code: string;
  message: string;
}
