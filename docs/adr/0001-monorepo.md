# ADR 0001: Monorepo with pnpm workspaces and Turborepo

Status: accepted (2026-10-13)

**Context.** The client and server share socket contracts, validation schemas, game rules and the Sudoku engine. Separate repositories would mean publishing packages and keeping versions in lockstep.

**Decision.** One repository with pnpm workspaces (`apps/*`, `packages/*`) and Turborepo for task orchestration and caching. Workspace packages export TypeScript sources directly ("just-in-time" packages); each consumer's tooling compiles them, so there is no build step between packages.

**Consequences.** A change to a payload fails type checking in both apps at once, and a feature touching client, server and protocol lands in one pull request. The server is bundled with esbuild so the production image does not need TypeScript sources.
