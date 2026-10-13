export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'username_taken',
  'email_taken',
  'invalid_credentials',
  'already_registered',
  'country_cooldown',
  'insufficient_coins',
  'not_owned',
  'not_purchasable',
  'already_owned',
  'already_in_queue',
  'already_in_match',
  'not_in_match',
  'already_in_tournament',
  'tournament_closed',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}
