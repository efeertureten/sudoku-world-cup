# Contributing

Thanks for helping! This guide gets you from clone to pull request. Türkçe konuşan katkıcılar issue ve PR'larda Türkçe yazabilir.

## Ground rules

- Be kind; see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Never weaken fair play: no solution, seed or anything that reveals answers may reach a client before a match ends.
- Report exploits privately ([SECURITY.md](SECURITY.md)), not in issues or pull requests.

## Set up

```bash
corepack enable          # gives you the pinned pnpm
pnpm install
pnpm infra:up            # Postgres and Redis in Docker (also creates the sudoku_test database)
pnpm dev                 # API :3000, web :5173
```

Prefer containers only? `docker compose up --build` runs the production setup on http://localhost:8080.

## Where things live

| You want to change… | Look in |
| --- | --- |
| How puzzles are generated, solved or graded | `packages/engine` |
| A socket event, payload, rule constant or validation | `packages/shared` (both apps compile against it) |
| Matches, bots, matchmaking, cups, rewards | `apps/server/src/modules/*` |
| Move validation and race-free finishing | `apps/server/src/redis/scripts.ts` |
| Database tables | `apps/server/src/db/schema.ts`, then `pnpm db:generate` |
| Screens and components | `apps/web/src/features/*`, `apps/web/src/components` |
| UI text | `apps/web/src/lib/i18n.ts` (every key exists in each language) |
| Board themes and kits | `content/themes`, `content/avatars` |

The design decisions behind this layout are recorded in [docs/adr](docs/adr).

## Good first contributions

### Add a board theme or kit (no code)

1. Copy an existing file in `content/themes/` or `content/avatars/` and give it a new kebab-case name; the file name must equal its `slug`.
2. Choose colours and an unlock rule: `default`, `trophies`, `wins`, `tournament_wins` or `price` (coins).
3. Register it in `packages/shared/src/cosmetics.ts` (one import, one list entry).
4. Run `pnpm --filter @swcup/shared test`; it fails if the file is invalid or unregistered.

Kits must be original: no real club or federation kits, crests or sponsor marks.

### Add a language

Copy the `en` dictionary in `apps/web/src/lib/i18n.ts`, translate the values, add it to `DICTIONARIES` and to the language switcher, and list singular forms in `SINGULAR` if your language changes the noun after the number 1. TypeScript reports any missing key.

## Making a change

1. Create a branch: `feat/short-description`, `fix/…`, `docs/…`.
2. Keep changes focused. If a socket payload changes, update `packages/shared` and [docs/PROTOCOL.md](docs/PROTOCOL.md) in the same PR.
3. Add or update tests. The engine and reward logic have unit tests; gameplay has end-to-end tests in `apps/server/test/integration.test.ts` that drive real sockets against Postgres and Redis.
4. Run `pnpm check` before pushing.
5. Use [Conventional Commits](https://www.conventionalcommits.org): `feat(server): add friend challenges`, `fix(web): keep notes after reconnect`.
6. Open a pull request and fill in the template. CI runs lint, typecheck, tests and builds, then starts the whole stack with Docker Compose and smoke-tests it through Caddy.

## Style

- TypeScript everywhere, strict mode. Formatting and linting are Biome (`pnpm format`, `pnpm lint`).
- Prefer small pure functions for game logic (they are easy to test) and keep I/O at the edges.
- Comments explain *why*, not *what*.

## Releasing (maintainers)

Tag `vX.Y.Z` on `main`. The release workflow publishes multi-arch server and web images to GHCR. Update `CHANGELOG.md` in the same PR that bumps versions.
