import type { ApiErrorBody } from '@swcup/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { ZodError, type ZodType, type z } from 'zod';
import { AppError } from '../lib/errors';
import { parseCookies, SESSION_COOKIE, type SessionStore } from '../modules/auth/session';
import { allowRate, type Redis } from '../redis/client';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      sessionId?: string;
    }
  }
}

export function sessionMiddleware(sessions: SessionStore): RequestHandler {
  return async (req, _res, next) => {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const userId = await sessions.resolve(sid);
    if (userId && sid) {
      req.userId = userId;
      req.sessionId = sid;
    }
    next();
  };
}

export function requireUser(req: Request): string {
  if (!req.userId) throw new AppError('unauthorized', 'Sign in or play as a guest first');
  return req.userId;
}

export function parse<S extends ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    throw new AppError('bad_request', message, result.error.issues);
  }
  return result.data;
}

/** Per-IP fixed-window limit for sensitive endpoints such as login. */
export function rateLimit(redis: Redis, bucket: string, limit: number, windowMs: number): RequestHandler {
  return async (req, _res, next) => {
    const ok = await allowRate(redis, bucket, req.ip ?? 'unknown', limit, windowMs);
    if (!ok) return next(new AppError('rate_limited', 'Too many attempts, try again in a minute'));
    next();
  };
}

export function errorHandler(log: Logger) {
  return (err: unknown, req: Request, res: Response<ApiErrorBody>, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Invalid input', details: err.issues } });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Malformed JSON' } });
      return;
    }
    log.error({ err, path: req.path }, 'unhandled request error');
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side' } });
  };
}
