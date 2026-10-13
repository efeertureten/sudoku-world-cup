/**
 * Lua scripts run atomically inside Redis. Keeping move validation and
 * "who finished first" in a single script removes every race between two
 * players (or two server instances) finishing in the same millisecond.
 */

/**
 * KEYS: match, player, playerLog
 * ARGV: userId, opponentId, cell, value, seq, nowMs, penaltyMs, maxMistakes, maxMovesPerSecond
 * Returns: [verdict, reason, mistakes, lockedUntil, filled, completed, matchEnded]
 */
export const MOVE_SCRIPT = `
local m, p, log = KEYS[1], KEYS[2], KEYS[3]
local uid, opp = ARGV[1], ARGV[2]
local cell, value = tonumber(ARGV[3]), ARGV[4]
local seq, now = tonumber(ARGV[5]), tonumber(ARGV[6])
local penalty, maxMistakes, maxRate = tonumber(ARGV[7]), tonumber(ARGV[8]), tonumber(ARGV[9])

local function num(key, field)
  return tonumber(redis.call('HGET', key, field) or '0') or 0
end
local function reject(reason)
  return {'rejected', reason, num(p, 'mistakes'), num(p, 'lockedUntil'), num(p, 'filled'), 0, 0}
end

if redis.call('EXISTS', p) == 0 then return {'rejected', 'not_in_match', 0, 0, 0, 0, 0} end

local lastSeq = num(p, 'lastSeq')
if seq == lastSeq then
  local cached = redis.call('HGET', p, 'lastResult')
  if cached then return cjson.decode(cached) end
end
if seq < lastSeq then return reject('stale') end

if redis.call('HGET', m, 'status') ~= 'in_progress' then return reject('not_in_progress') end
if now >= num(m, 'endsAt') then return reject('time_up') end

local windowStart, windowCount = num(p, 'rlStart'), num(p, 'rlCount')
if now - windowStart >= 1000 then windowStart, windowCount = now, 0 end
windowCount = windowCount + 1
redis.call('HSET', p, 'rlStart', windowStart, 'rlCount', windowCount)
if windowCount > maxRate then return reject('rate_limited') end

if now < num(p, 'lockedUntil') then return reject('locked') end
if string.sub(redis.call('HGET', m, 'givens'), cell + 1, cell + 1) ~= '0' then return reject('given') end
local board = redis.call('HGET', p, 'board')
if string.sub(board, cell + 1, cell + 1) ~= '0' then return reject('filled') end

local t = now - num(m, 'startedAt')
local verdict, completed, ended = 'wrong', 0, 0
if string.sub(redis.call('HGET', m, 'solution'), cell + 1, cell + 1) == value then
  verdict = 'correct'
  board = string.sub(board, 1, cell) .. value .. string.sub(board, cell + 2)
  local filled = redis.call('HINCRBY', p, 'filled', 1)
  redis.call('HSET', p, 'board', board, 'lastCorrectAt', t)
  redis.call('RPUSH', log, cell .. ',' .. value .. ',1,' .. t)
  if filled >= num(m, 'totalEmpty') then
    completed = 1
    redis.call('HSET', p, 'finishedAt', t)
    if redis.call('HSETNX', m, 'winner', uid) == 1 then
      redis.call('HSET', m, 'status', 'finished', 'endReason', 'completed', 'endedAt', now)
      ended = 1
    end
  end
else
  local mistakes = redis.call('HINCRBY', p, 'mistakes', 1)
  redis.call('HSET', p, 'lockedUntil', now + penalty)
  redis.call('RPUSH', log, cell .. ',' .. value .. ',0,' .. t)
  if mistakes >= maxMistakes and redis.call('HSETNX', m, 'winner', opp) == 1 then
    redis.call('HSET', m, 'status', 'finished', 'endReason', 'mistakes', 'endedAt', now)
    ended = 1
  end
end

local res = {verdict, '', num(p, 'mistakes'), num(p, 'lockedUntil'), num(p, 'filled'), completed, ended}
redis.call('HSET', p, 'lastSeq', seq, 'lastResult', cjson.encode(res))
return res
`;

/**
 * Ends a live match exactly once.
 * KEYS: match   ARGV: winner ('' = draw), reason, nowMs
 * Returns 1 if this call ended the match, 0 if it had already ended.
 */
export const FINISH_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if not status or status == 'finished' or status == 'aborted' then return 0 end
local winner = ARGV[1]
if winner == '' then winner = 'draw' end
if redis.call('HSETNX', KEYS[1], 'winner', winner) == 0 then return 0 end
redis.call('HSET', KEYS[1], 'status', 'finished', 'endReason', ARGV[2], 'endedAt', ARGV[3])
return 1
`;

/**
 * Compare-and-set on a hash's status field.
 * KEYS: hash   ARGV: expectedStatus, newStatus, field1, value1, ...
 */
export const TRANSITION_SCRIPT = `
if redis.call('HGET', KEYS[1], 'status') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'status', ARGV[2])
for i = 3, #ARGV, 2 do redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1]) end
return 1
`;

/**
 * Removes two queued players together, or neither.
 * KEYS: queueRating, queueTime   ARGV: userA, userB
 */
export const PAIR_POP_SCRIPT = `
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) or not redis.call('ZSCORE', KEYS[1], ARGV[2]) then return 0 end
redis.call('ZREM', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZREM', KEYS[2], ARGV[1], ARGV[2])
return 1
`;

/**
 * Pops due timers.
 * KEYS: timers   ARGV: nowMs, limit
 */
export const POP_DUE_SCRIPT = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
if #due > 0 then redis.call('ZREM', KEYS[1], unpack(due)) end
return due
`;

/**
 * Extends a lock only if we still own it.
 * KEYS: lock   ARGV: owner, ttlMs
 */
export const RENEW_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return 0
`;

/** KEYS: lock   ARGV: owner */
export const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;
