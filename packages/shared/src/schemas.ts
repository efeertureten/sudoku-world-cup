import { z } from 'zod';
import { isCountryCode } from './countries';
import { DIFFICULTIES, EMOTE_IDS, QUEUE_MODES } from './rules';

/** Validation shared by REST handlers, socket handlers and client forms. */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'At least 3 characters')
  .max(20, 'At most 20 characters')
  .regex(/^[A-Za-z0-9_.]+$/, 'Letters, digits, dot and underscore only');

export const countryCodeSchema = z
  .string()
  .length(2)
  .transform((s) => s.toUpperCase())
  .refine(isCountryCode, 'Unknown country code');

export const guestInput = z.object({
  username: usernameSchema,
  countryCode: countryCodeSchema,
});

export const registerInput = z.object({
  username: usernameSchema.optional(),
  countryCode: countryCodeSchema.optional(),
  email: z.email().max(254),
  password: z.string().min(8, 'At least 8 characters').max(128),
});

export const loginInput = z.object({
  login: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(128),
});

export const updateMeInput = z.object({
  countryCode: countryCodeSchema.optional(),
});

export const queueJoinInput = z.object({
  mode: z.enum(QUEUE_MODES),
  difficulty: z.enum(DIFFICULTIES).optional(),
});

export const matchIdInput = z.object({ matchId: z.uuid() });

export const moveInput = z.object({
  matchId: z.uuid(),
  seq: z.number().int().min(1).max(100_000),
  cell: z.number().int().min(0).max(80),
  value: z.number().int().min(1).max(9),
});

export const emoteInput = z.object({
  matchId: z.uuid(),
  emoteId: z.enum(EMOTE_IDS),
});

export const clockPingInput = z.object({ clientTs: z.number() });

export const tournamentWatchInput = z.object({ tournamentId: z.uuid() });

export const leaderboardWatchInput = z.object({ on: z.boolean() });

export const emptyInput = z.object({}).loose().optional();

export const countryLeaderboardQuery = z.object({
  metric: z.enum(['total', 'top50']).default('total'),
  season: z.coerce.number().int().positive().optional(),
});

export const playerLeaderboardQuery = z.object({
  country: countryCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const historyQuery = z.object({
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Request bodies as the client sends them (before server-side normalisation). */
export type GuestRequest = z.input<typeof guestInput>;
export type RegisterRequest = z.input<typeof registerInput>;
export type LoginRequest = z.input<typeof loginInput>;

export type GuestInput = z.infer<typeof guestInput>;
export type RegisterInput = z.infer<typeof registerInput>;
export type LoginInput = z.infer<typeof loginInput>;
export type UpdateMeInput = z.infer<typeof updateMeInput>;
export type QueueJoinInput = z.infer<typeof queueJoinInput>;
export type MatchIdInput = z.infer<typeof matchIdInput>;
export type MoveInput = z.infer<typeof moveInput>;
export type EmoteInput = z.infer<typeof emoteInput>;
