/**
 * Game rules both sides agree on. Server-tunable values (bot fallback delay,
 * match time limit, tournament fill time) are sent to clients via GET /meta.
 */
export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const MATCH_TYPES = ['ranked', 'casual', 'tournament'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const QUEUE_MODES = ['ranked', 'casual'] as const;
export type QueueMode = (typeof QUEUE_MODES)[number];

export const GAME_RULES = {
  /** The third wrong digit is a red card: the round is lost. */
  maxMistakes: 3,
  /** Input is frozen this long after a wrong digit (server enforced). */
  penaltyLockMs: 3_000,
  readyCheckMs: 10_000,
  countdownMs: 3_000,
  reconnectGraceMs: 30_000,
  maxMovesPerSecond: 8,
  emoteCooldownMs: 2_000,
  countryChangeCooldownDays: 30,
  tournamentSize: 16,
  /** Difficulty per knockout round: round of 16, quarter-final, semi-final, final. */
  tournamentRoundDifficulties: ['easy', 'medium', 'medium', 'hard'] as const satisfies readonly Difficulty[],
} as const;

export const TOURNAMENT_ROUNDS = 4;
export const TOURNAMENT_ROUND_KEYS = ['r16', 'qf', 'sf', 'final'] as const;

export const MATCH_END_REASONS = [
  'completed',
  'mistakes',
  'timeout',
  'forfeit',
  'disconnect',
  'no_show',
] as const;
export type MatchEndReason = (typeof MATCH_END_REASONS)[number];

export const EMOTES = [
  { id: 'gg', glyph: '🤝' },
  { id: 'clap', glyph: '👏' },
  { id: 'fire', glyph: '🔥' },
  { id: 'fast', glyph: '⚡' },
  { id: 'oops', glyph: '😅' },
  { id: 'think', glyph: '🤔' },
] as const;
export type EmoteId = (typeof EMOTES)[number]['id'];
export const EMOTE_IDS = EMOTES.map((e) => e.id) as [EmoteId, ...EmoteId[]];
