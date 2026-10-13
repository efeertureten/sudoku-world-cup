import { randomBytes } from 'node:crypto';
import type { Redis } from '../../redis/client';
import { keys, SESSION_TTL_SECONDS } from '../../redis/keys';

export const SESSION_COOKIE = 'swc_sid';

/**
 * Opaque session ids stored in Redis. Unlike a JWT a session can be revoked
 * instantly, and the same cookie authenticates both REST calls and the
 * Socket.io handshake because everything is served from one origin.
 */
export class SessionStore {
  constructor(private readonly redis: Redis) {}

  async create(userId: string): Promise<string> {
    const sid = randomBytes(32).toString('base64url');
    await this.redis.set(keys.session(sid), userId, 'EX', SESSION_TTL_SECONDS);
    return sid;
  }

  /** Returns the user id and slides the expiry window. */
  async resolve(sid: string | undefined): Promise<string | null> {
    if (!sid || sid.length > 64) return null;
    const key = keys.session(sid);
    const userId = await this.redis.get(key);
    if (userId) await this.redis.expire(key, SESSION_TTL_SECONDS);
    return userId;
  }

  async destroy(sid: string | undefined): Promise<void> {
    if (sid) await this.redis.del(keys.session(sid));
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function sessionCookie(sid: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(sid)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearedSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
