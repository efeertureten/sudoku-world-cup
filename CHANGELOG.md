# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-10-13

First public version.

### Added

- Deterministic Sudoku engine: seeded generator with unique-solution guarantee, bitmask solver, human-technique difficulty grader, singles finder.
- Server-authoritative 1v1 matches with atomic Redis move validation, 3-second penalty lock, 3-mistake red card, time limit, reconnect grace period and resume.
- Rating-based matchmaking (hidden Glicko-2) with a widening search window and human-like bot fallback.
- 16-player knockout cups with seeding, per-round shared puzzles, bot backfill and simulated bot-vs-bot ties.
- Trophies, six leagues, coins, purchasable and earnable board themes and kits defined in `/content`.
- Country leaderboard (total and best-50 metrics) with live updates and an append-only points ledger.
- Post-match anti-cheat analysis with held country points and an admin review API.
- React client with lobby, live board, bracket, standings, locker room and profile, in Turkish and English.
- Public, shareable match replays (`/m/:id`) with both boards side by side, a move timeline and in-browser puzzle regeneration from the seed to verify a match.
- Wins against bots in ranked and cup matches score 3 country points, capped at 30 per player per UTC day; a cup won against bots earns a small champion bonus.
- Docker Compose setup served through Caddy on a single origin, CI with a Compose smoke test, CodeQL and release workflows.
