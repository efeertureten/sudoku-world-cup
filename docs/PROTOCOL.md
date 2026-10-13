# Protocol reference

The authoritative definitions are the TypeScript interfaces in `packages/shared/src/events.ts` (Socket.io) and `packages/shared/src/types.ts` (payloads). This page is the human-readable version. Update both in the same pull request.

## Conventions

- REST base path: `/api/v1`. Errors have the shape `{ "error": { "code": "...", "message": "..." } }`.
- Socket.io path: `/socket.io`, authenticated by the `swc_sid` session cookie during the handshake. Without a valid session the connection fails with `unauthorized`.
- Every client → server event takes a payload and an acknowledgement callback. The server answers exactly once with `{ ok: true, data }` or `{ ok: false, code, message }`.
- Event names follow `area:action`. Timestamps are milliseconds since the Unix epoch on the **server** clock.
- Cells are numbered 0–80 in row-major order. Boards are 81-character strings with `0` for empty cells.

## REST

| Method and path | Auth | Description |
| --- | --- | --- |
| `GET /healthz` | – | Liveness. |
| `GET /readyz` | – | Checks Postgres and Redis; reports whether this instance is the leader. |
| `GET /meta` | – | Countries, leagues, current season, server tunables, themes and kits. |
| `POST /auth/guest` | – | `{ username, countryCode }` → creates a guest and sets the session cookie. |
| `POST /auth/register` | optional | `{ email, password, username?, countryCode? }`. Upgrades the current guest in place, or creates a new account. |
| `POST /auth/login` | – | `{ login, password }` where `login` is a username or email. |
| `POST /auth/logout` | yes | Deletes the session. |
| `GET /auth/me` | yes | Full profile of the signed-in player. |
| `PATCH /users/me` | yes | `{ countryCode }`; allowed once every 30 days. |
| `GET /users/:username` | – | Public profile with the last 10 matches. |
| `GET /users/:username/matches?before=&limit=` | – | Match history, newest first (cursor is an ISO timestamp). |
| `GET /matches/:id` | – | Finished match with givens, solution, generator seed and version, and both move logs (powers the public replay page `/m/:id`). |
| `GET /leaderboards/countries?metric=total\|top50&season=` | – | Country standings for a season. |
| `GET /leaderboards/players?country=&limit=` | – | Players by trophies (bots excluded). |
| `GET /tournaments` | – | `{ current, recent }`: the open lobby and recent cups. |
| `GET /tournaments/:id` | – | Bracket of a live or finished cup. |
| `GET /cosmetics` | yes | Every theme and kit with `owned`, `equipped` and `price`. |
| `POST /cosmetics/:slug/purchase` | yes | Buys a priced item. |
| `POST /cosmetics/:slug/equip` | yes | Equips an owned item. |
| `GET /admin/flags?status=` | admin | Anti-cheat review queue (`Authorization: Bearer $ADMIN_TOKEN`). |
| `POST /admin/flags/:id/resolve` | admin | `{ action: "clear" \| "confirm", note? }`. Clearing releases held country points. |

## Client → server events

| Event | Payload | Ack data |
| --- | --- | --- |
| `clock:ping` | `{ clientTs }` | `{ clientTs, serverTs }` |
| `queue:join` | `{ mode: "ranked" \| "casual", difficulty? }` | `{ queuedAt }` |
| `queue:leave` | `{}` | `null` |
| `match:ready` | `{ matchId }` | `null` |
| `match:move` | `{ matchId, seq, cell, value }` | `MoveAck` |
| `match:forfeit` | `{ matchId }` | `null` |
| `match:emote` | `{ matchId, emoteId }` (`gg`, `clap`, `fire`, `fast`, `oops`, `think`) | `null` |
| `tournament:join` | `{}` | `TournamentState` |
| `tournament:leave` | `{}` (lobby only) | `null` |
| `tournament:watch` | `{ tournamentId }` | `TournamentState` |
| `leaderboard:watch` | `{ on }` | `null` |

`MoveAck`: `{ seq, cell, value, verdict: "correct" | "wrong" | "rejected", reason?, mistakes, lockedUntil, filled, completed }`. Rejection reasons: `not_in_match`, `not_in_progress`, `time_up`, `rate_limited`, `locked`, `given`, `filled`, `stale`. Sending the same `seq` again returns the original answer.

## Server → client events

| Event | When | Payload highlights |
| --- | --- | --- |
| `queue:status` | About once a second while queued | `elapsedMs`, `searchRange`, `botInMs` |
| `match:found` | A match was created for you | `matchId`, `type`, `difficulty`, `you`, `opponent` (with `isBot`), `readyDeadline`, `tournament?` |
| `match:countdown` | Both players are ready | `startsAt`, `serverNow` |
| `match:start` | Kick-off | `givens`, `startedAt`, `endsAt`, `totalEmpty` |
| `match:opponent_progress` | Opponent made a move | `filled`, `mistakes`, `cell?` (only for correct moves), `lockedUntil?` |
| `match:opponent_connection` | Opponent dropped or came back | `connected`, `graceEndsAt?` |
| `match:resume` | You (re)connected during a live match | status, both players, your board, counts, `lastSeq`, timings |
| `match:emote` | Opponent sent a reaction | `from`, `emoteId` |
| `match:end` | The match finished | `winnerId` (null for a draw), `reason`, per-player `results` with rewards and unlocks, `solution`, `generatorSeed`, `tournament?` |
| `tournament:state` | Lobby or bracket changed | full `TournamentState` |
| `leaderboard:tick` | Top countries changed (watchers only) | `countries` |
| `notice` | Informational message | `code`, `message` |

## A typical match

```
client A                    server                     client B
   │── queue:join ─────────►│◄────────── queue:join ─────│
   │◄─ match:found ─────────│────────── match:found ────►│
   │── match:ready ────────►│◄────────── match:ready ────│
   │◄─ match:countdown ─────│──────── match:countdown ──►│
   │◄─ match:start ─────────│─────────── match:start ───►│
   │── match:move ─────────►│                            │
   │◄─ ack (correct) ───────│── opponent_progress ──────►│
   │            …           │            …               │
   │── match:move (last) ──►│                            │
   │◄─ ack (completed) ─────│                            │
   │◄─ match:end ───────────│──────────── match:end ────►│
```
