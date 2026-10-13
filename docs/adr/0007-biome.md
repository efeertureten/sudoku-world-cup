# ADR 0007: Biome for linting and formatting

Status: accepted (2026-10-13)

**Context.** ESLint, Prettier and the TypeScript plugins mean several configuration files and many dependencies.

**Decision.** Biome handles linting, formatting and import sorting with one configuration file.

**Consequences.** Faster checks and a simpler setup for contributors. A few niche ESLint rules are unavailable; the project has not needed them.
