/**
 * Every Redis key the server touches, in one place. Redis holds only
 * ephemeral state (sessions, queues, live matches, lobbies, timers, caches);
 * losing it loses in-flight matches but never persistent data.
 */
export const keys = {
  session: (sid: string) => `sess:${sid}`,

  match: (matchId: string) => `match:${matchId}`,
  matchPlayer: (matchId: string, userId: string) => `match:${matchId}:p:${userId}`,
  matchLog: (matchId: string, userId: string) => `match:${matchId}:log:${userId}`,
  matchBot: (matchId: string, userId: string) => `match:${matchId}:bot:${userId}`,
  matchEmote: (matchId: string, userId: string) => `match:${matchId}:emote:${userId}`,

  userMatch: (userId: string) => `user:${userId}:match`,
  userQueue: (userId: string) => `user:${userId}:queue`,
  userTournament: (userId: string) => `user:${userId}:tournament`,
  userSeenPuzzles: (userId: string) => `user:${userId}:seen`,

  queueRating: (queue: string) => `mm:q:${queue}`,
  queueTime: (queue: string) => `mm:t:${queue}`,
  queues: 'mm:queues',

  timers: 'timers',
  leaderLock: 'lock:leader',
  lock: (name: string) => `lock:${name}`,

  puzzlePool: (difficulty: string) => `pool:${difficulty}`,
  busyBots: 'bots:busy',

  tournamentLobby: 'tourn:lobby',
  tournament: (id: string) => `tourn:${id}`,

  countryLeaderboard: (seasonId: number) => `lb:country:${seasonId}`,
  leaderboardCache: (name: string) => `lbcache:${name}`,

  rateLimit: (bucket: string, id: string) => `rl:${bucket}:${id}`,
} as const;

/** TTL for live match keys: long enough for any match plus reconnects. */
export const MATCH_TTL_SECONDS = 3 * 60 * 60;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
