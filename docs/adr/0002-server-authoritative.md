# ADR 0002: Server-authoritative matches and secret solutions

Status: accepted (2026-10-13)

**Context.** In a race, whoever sees the solution wins. The project is open source, so hiding logic is impossible; only data can stay secret.

**Decision.** The server owns the game state. Clients receive only the givens. The solution and the generator seed stay in Redis until the match ends. Every move is validated by one Lua script that also enforces the rate limit, the penalty lock and the mistake limit, and decides the winner with `HSETNX`. The browser bundle contains only rule helpers (conflict and candidate checks), never a solver.

**Consequences.** A modified client gains no information. Moves cost one round trip, which is fine for a puzzle game; the UI shows pending digits until the server answers. External solvers remain possible and are handled by post-match analysis (see ARCHITECTURE.md).
