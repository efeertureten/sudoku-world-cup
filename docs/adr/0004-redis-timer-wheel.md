# ADR 0004: Durable timers in Redis with a single leader

Status: accepted (2026-10-13)

**Context.** Matches need many deadlines: ready checks, countdowns, time limits, reconnect grace periods, bot moves and cup deadlines. In-process `setTimeout`s are lost on restart and tie a match to one instance.

**Decision.** Every deadline is a member of one Redis sorted set scored by due time. One instance holds a renewable leader lease and pops due timers atomically every 100 ms. The same leader runs matchmaking ticks and leaderboard broadcasts. Bots are stateless timer callbacks that read their board from Redis.

**Consequences.** Timers survive restarts and fail over with the lease. Resolution is about 100 ms, far below what players notice.
