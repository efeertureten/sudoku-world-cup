# Architecture

This document explains how Sudoku World Cup works and why it is built this way. The decisions are recorded one by one in [adr/](adr).

## Overview

```
 Browser ──► Caddy (:8080) ─┬─ /            static React app
                            ├─ /api/*       ─┐
                            └─ /socket.io/* ─┴─► Node.js server (:3000)
                                                   ├─ Express REST API
                                                   ├─ Socket.io gateway
                                                   ├─ match engine, bots, matchmaker, cups
                                                   └─ leader loops (timers, matchmaking, broadcasts)
                                                        │              │
                                                     Redis         PostgreSQL ◄── puzzle worker
                                               (live, ephemeral)  (permanent)
```

Everything is served from one origin. The opaque session cookie therefore authenticates REST calls and the Socket.io handshake alike, with no CORS configuration.

## Repository layout

| Path | Role |
| --- | --- |
| `packages/engine` | Zero-dependency Sudoku core: seeded PRNG, bitmask solver, generator, human-technique grader, singles finder, client-safe rule helpers. |
| `packages/shared` | The contract: Socket.io event interfaces, zod schemas, DTO types, game rules, leagues, countries, cosmetics. Both apps compile against it. |
| `apps/server` | Express + Socket.io server and the puzzle worker, bundled with esbuild. |
| `apps/web` | React 19 + Vite + Tailwind CSS 4 + Motion client. The lobby and the board load up front; standings, cups, locker, profile and replays are code-split. |
| `content` | Board themes and kits as JSON, validated by tests. |
| `infra/docker` | Dockerfiles and the Caddy configuration. |

The monorepo uses pnpm workspaces and Turborepo. Workspace packages export TypeScript sources directly; Vite, Vitest, tsx and esbuild compile them where they are used, so there is no build step between packages.

## Data

### PostgreSQL (permanent)

| Table | Purpose |
| --- | --- |
| `users`, `player_stats` | Identity (guest or registered, or bot) and hot counters: trophies, league, hidden Glicko-2 rating, wins, streak, coins. |
| `puzzles` | The puzzle bank: givens, solution, difficulty, grader score, hardest technique, generator seed and version. |
| `matches`, `match_participants` | Finished matches and each player's result, timings, rewards, full move log and anti-cheat score. |
| `tournaments`, `tournament_entries` | Cups with their final bracket, seeds and placements. |
| `country_points_ledger`, `country_season_scores` | Append-only ledger of country points (idempotent per user, reason and reference) plus running totals per season. |
| `cosmetics`, `user_cosmetics`, `currency_ledger` | Catalogue, ownership and an idempotent coin ledger. |
| `anticheat_flags` | Review queue; holds withheld country points. |
| `countries`, `leagues`, `seasons` | Reference data, seeded on startup. Seasons last 28 days and roll over automatically. |

Usernames and emails are unique case-insensitively through expression indexes. The coin balance has a `CHECK (coins >= 0)` backing the conditional update used for purchases.

### Redis (live)

| Key | Content |
| --- | --- |
| `sess:{sid}` | Session → user id, sliding 30-day expiry. |
| `mm:q:{queue}`, `mm:t:{queue}` | Matchmaking queue by rating and by enqueue time. |
| `match:{id}` | Live match: status, players, givens, **solution**, timings, winner. |
| `match:{id}:p:{user}` | Each player's board, filled count, mistakes, lock, last sequence number. |
| `match:{id}:log:{user}` | Move log, copied to Postgres when the match ends. |
| `match:{id}:bot:{bot}` | Bot pace, error rate and planned move. |
| `user:{id}:match`, `user:{id}:tournament` | Pointers used to resume after reconnecting. |
| `timers` | Sorted set of due timers (see below). |
| `tourn:lobby`, `tourn:{id}` | Open lobby id and live cup state. |
| `pool:{difficulty}` | Puzzle ids for O(1) random picks. |
| `lock:*` | Leader lease and short mutexes. |

Losing Redis loses in-flight matches and queues, never permanent data.

## Match lifecycle

```
ready_check ──(both ready)──► countdown ──(3 s)──► in_progress ──► finished
     │                                                  │
     └──(10 s, nobody ready)──► aborted                 └─ completed | mistakes | timeout | forfeit | disconnect | no_show
```

1. **Creation.** The matchmaker or a cup creates the match: picks a puzzle neither human has seen recently, writes the Redis state, schedules the ready deadline and emits `match:found`. Bots are ready immediately.
2. **Ready check.** Clients confirm automatically when the board loads. If only one side confirms within 10 s, the other loses by `no_show`.
3. **Countdown and start.** `match:countdown` carries the server time of kick-off; at that moment `match:start` delivers the givens. The solution is never part of any payload before the end.
4. **Moves.** Each `match:move` runs one Lua script (`apps/server/src/redis/scripts.ts`) that checks, in order: the sequence number (a repeated sequence returns the cached answer, so retries are idempotent), status and time limit, a per-second rate limit, the penalty lock, given and filled cells, and finally the digit against the solution. A correct digit updates the board; completing it sets the winner with `HSETNX`, so two players finishing in the same millisecond still produce exactly one winner. A wrong digit adds a mistake and a 3-second lock; the third mistake hands the win to the opponent. The opponent receives `match:opponent_progress` with counts and the solved cell, never the digit.
5. **Ending.** Time limit, forfeit, disconnect and no-show all go through another script that ends a match at most once.
6. **Finalisation.** `MatchService.finalize` claims the match with `HSETNX finalized`, computes results, runs anti-cheat, and writes everything in one transaction: match row (insert-or-nothing makes retries harmless), participants, ratings, trophies, coins, country points, unlocks and flags. Only then are `match:end` payloads sent, including the solution and generator seed, and listeners (the cup service) are notified.

**Reconnects.** When a player's last socket disconnects during a match, a 30-second grace timer starts and the opponent is told. Reconnecting cancels it and sends `match:resume` with the full board. If the timer fires, the player loses by `disconnect`.

**Timing.** All durations come from the server clock. Clients estimate their clock offset with `clock:ping` only to draw countdowns. No lag compensation is needed: only the arrival time of the final move matters, and a few tens of milliseconds are negligible over a multi-minute race.

## Timers and leadership

Ready deadlines, countdowns, time limits, grace periods, bot moves, cup fill deadlines and next-round kick-offs are entries in one Redis sorted set scored by due time. The **leader** instance pops due entries atomically every 100 ms and runs their handlers. Leadership is a Redis lease renewed every 2 s; if the leader dies, another instance takes over within about 6 s, and pending timers survive restarts.

The leader also runs the matchmaker every 250 ms and pushes leaderboard updates every 5 s. Socket.io uses the Redis adapter, so any instance can emit to any player. The current deployment runs one server instance; the design allows more behind sticky sessions.

## Matchmaking

Each queue (ranked, or casual per difficulty) keeps players by hidden Glicko-2 rating and by waiting time. On every tick, starting with whoever waited longest, the matchmaker looks for the closest rating within a window that starts at ±50 and grows by 50 per second up to ±400. Pairs leave the queue together through a Lua script, so a player cannot be matched twice. After `BOT_FALLBACK_MS` (5 s) a bot with a similar rating is assigned. Ranked matches use the puzzle difficulty of the lower player's league.

## Bots

Bots are user rows with `is_bot = true`, always shown with a bot badge. They play through exactly the same validation path as people. The decision logic (`modules/bot/brain.ts`) is pure and unit-tested:

- It looks for cells a person could deduce right now (naked and hidden singles), prefers the area it just worked in, and only falls back to the tightest cell when advanced techniques are needed, thinking longer then.
- Think times are log-normal around a target pace. If the human has at least three finished games on that difficulty, the bot targets the human's own pace ±20%, which keeps bot games close; otherwise the pace follows the bot's rating.
- It occasionally places a plausible wrong digit, more often on non-trivial cells, and becomes careful on its last card.

Bot games award half the trophies and fewer coins. A win against a bot in a ranked or cup match scores 3 country points, but those points are capped at 30 per player per UTC day (the ledger reasons end in `_bot`, and the cap is checked inside the finalisation transaction). The table stays alive on a small server without anyone being able to farm it against bots.

## Cups

A 16-seat lobby fills with people for `TOURNAMENT_FILL_MS` (60 s); bots take the remaining seats. Players are seeded by trophies so that seeds 1 and 2 can only meet in the final. Each round uses one puzzle for every match (easy, medium, medium, hard). Bot-vs-bot ties are simulated instantly with an Elo-style probability, so people never wait for them; when both finalists of the next match are known and a person is involved, the match starts 8 s later to leave time for the result screen. Eliminated players receive their placement coins immediately; the champion receives coins, a cup win and bonus country points: 50 when at least two people took part, 10 for a cup played against bots. Bracket updates are serialised with a Redis lock per cup.

## Rewards and progression

All balancing lives in `modules/rating/rewards.ts`:

- **Trophies** (ranked only): win 30 ± up to 10 depending on the opponent's trophies, loss 20 ± up to 8; losses are halved below 400 trophies; bot games count half. Six leagues from Bronze (0) to Champions (4000) set the ranked puzzle difficulty.
- **Rating**: Glicko-2, updated after each ranked match, used only for matchmaking.
- **Coins**: earned every match and from cup placements; spent on themes and kits.
- **Country points**: ranked wins against people (10, +5 against a higher-ranked opponent), cup wins against people by round (10/20/40/80), wins against bots in ranked and cup matches (3, capped at 30 per player per day) and the champion bonus. Quick matches never score.
- **Cosmetics** unlock by trophies, wins, cup wins or coins, checked inside the same transaction that changes the stats.

## Puzzle generation

1. **Full grid.** The three diagonal 3×3 boxes are independent, so they get random permutations; a randomised solver completes the rest.
2. **Digging.** Clues are removed in random (often symmetric) order; after each removal the solver counts solutions up to two and restores the clue unless exactly one remains. Uniqueness is essential: the server checks moves against a single stored solution.
3. **Grading.** A logical solver applies human techniques in increasing difficulty (hidden and naked singles, locked candidates, naked and hidden pairs and triples, X-Wing). The hardest technique needed, together with the clue count, sets the band: easy, medium, hard, or expert when X-Wing or anything beyond the implemented techniques is required.
4. **Banking.** Generation is deterministic for a seed and generator version. The worker keeps `PUZZLE_POOL_TARGET` puzzles per difficulty; the server tops up a small minimum at boot so a fresh install works without the worker.

On a typical machine easy and medium puzzles take about 1–2 ms, expert about 10 ms and hard about 60 ms.

## Fair play

Kerckhoffs's principle applies: the code is public, so the secret is the data. Because the engine is open source, the generator seed is as sensitive as the solution and is treated the same way.

| Threat | Defence |
| --- | --- |
| Reading the solution from network traffic or memory | The solution and seed never leave the server before the match ends. The client bundle contains no solver. |
| Faking timestamps | Every duration is measured on the server. |
| Guessing digits by trial and error | 3-second lock per wrong digit and a 3-mistake limit. |
| Replaying or forging events | Session-bound sockets, monotonic sequence numbers, idempotent answers, zod validation, per-second move limit. |
| Copying answers from an external solver | Post-match behavioural analysis (below). |

The analyser (`modules/anticheat/analyzer.ts`) scores each human's move log on:

- **Timing regularity**: coefficient of variation of the intervals between moves; scripts are metronomic.
- **Pace**: median interval and time per solved cell against plausible human limits for the difficulty.
- **Fill order**: share of consecutive fills in increasing cell order, typical of solvers that walk the grid.
- **Deducibility**: the board is replayed from the player's own moves; for the first 20 fills it checks whether each digit was a naked or hidden single at that moment. People can only place what they can deduce, so early fills are almost always singles; someone copying a solver places arbitrary cells. The thresholds were calibrated against the bot brain (as a proxy for human play) and against random-order solver play.

A score of 0.6 or more creates an `anticheat_flags` row. The match result stands, but the country points are withheld until a reviewer clears the flag through the admin API. Nothing is banned automatically. These are heuristics: a patient cheater who copies only deducible cells at a human pace is very hard to detect, which is why detection improvements are welcome contributions.

Finished matches are public at `GET /api/v1/matches/:id`, including the givens, the solution, the generator seed and version, and both move logs. The web app turns that into a shareable replay page (`/m/:id`, viewable without an account) that plays both boards side by side, and its "Regenerate the puzzle" button loads the engine in the browser, rebuilds the puzzle from the seed and checks that the givens, the solution and its uniqueness all match.

## Security notes

- Passwords use Argon2id; login timing is equalised for unknown users.
- Sessions are 256-bit random ids in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` behind HTTPS). Logging out deletes the session in Redis immediately.
- Auth endpoints are rate-limited per IP.
- Request bodies are capped at 32 KB and validated with zod; errors never leak internals.
- Helmet sets security headers on the API; Caddy sets them for the app.
