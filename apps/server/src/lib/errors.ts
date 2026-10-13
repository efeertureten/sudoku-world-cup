import type { ErrorCode } from '@swcup/shared';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  username_taken: 409,
  email_taken: 409,
  invalid_credentials: 401,
  already_registered: 409,
  country_cooldown: 409,
  insufficient_coins: 409,
  not_owned: 409,
  not_purchasable: 409,
  already_owned: 409,
  already_in_queue: 409,
  already_in_match: 409,
  not_in_match: 409,
  already_in_tournament: 409,
  tournament_closed: 409,
  internal: 500,
};

/** An error that is safe to show to the client. Anything else becomes `internal`. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code.replace(/_/g, ' '));
    this.status = STATUS[code];
  }
}

interface PgLikeError {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

/** Postgres error details, unwrapping drizzle's query error wrapper when present. */
export function pgError(err: unknown): PgLikeError | null {
  let current: unknown = err;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
    const e = current as PgLikeError;
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    current = e.cause;
  }
  return null;
}

export const isUniqueViolation = (err: unknown): boolean => pgError(err)?.code === '23505';
