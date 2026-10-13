## What and why

<!-- One or two sentences on the change and the problem it solves. Link the issue: Closes #123 -->

## How it was tested

<!-- Commands you ran, screenshots or GIFs for UI changes. -->

## Checklist

- [ ] `pnpm check` passes (lint, typecheck, tests)
- [ ] Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:` …)
- [ ] If a socket event or payload changed: `packages/shared` and `docs/PROTOCOL.md` are updated
- [ ] If the database schema changed: a migration was generated with `pnpm db:generate`
- [ ] No solution, seed or other answer-revealing data reaches the client before a match ends
- [ ] UI text is added to both languages in `apps/web/src/lib/i18n.ts`
