# Security and fair play

## Reporting

Please report vulnerabilities **and ways to cheat** privately through a [GitHub security advisory](https://github.com/efeertureten/sudoku-world-cup/security/advisories/new). Do not open public issues or pull requests that describe an exploit before a fix is released.

Include what you did, what you could achieve (see a solution early, change a result, gain trophies or coins, impersonate a player…) and the version or commit. We aim to acknowledge reports within 72 hours and to publish a fix and credit you, if you wish, once it is deployed.

## In scope

- Anything that reveals a puzzle's solution or generator seed to a client before the match ends.
- Bypassing move validation, the penalty lock, the mistake limit, rate limits or server-side timing.
- Changing match results, ratings, trophies, coins, country points or cosmetics without playing.
- Session hijacking, authentication or authorisation bypasses, injection, XSS, CSRF.
- Denial of service through a single client (for example, one socket starving the server).

## Out of scope

- Using an external solver and typing its answers by hand. We cannot prevent this technically; post-match behavioural analysis flags it for review instead (see `docs/ARCHITECTURE.md`). Ideas that improve detection are welcome as regular issues.
- Volumetric DDoS, social engineering and vulnerabilities in third-party services you host it on.

## Hardening checklist for self-hosters

- Serve over HTTPS and set `COOKIE_SECURE=true`.
- Change the default Postgres credentials in `.env`.
- Keep `ADMIN_TOKEN` empty unless you use the review API, and make it long and random if you do.
- Do not expose Postgres or Redis ports publicly (the production compose file does not).
