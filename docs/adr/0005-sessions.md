# ADR 0005: Opaque sessions in Redis instead of JWTs

Status: accepted (2026-10-13)

**Context.** Players start as guests and may register later. Sessions must authenticate both REST and WebSocket traffic.

**Decision.** A 256-bit random id in an `HttpOnly`, `SameSite=Lax` cookie, mapped to the user in Redis with a sliding 30-day expiry. The web app, API and socket share one origin behind Caddy.

**Consequences.** Logging out revokes a session instantly and no signing key needs managing. Each request costs one Redis lookup. Same-origin deployment avoids CORS and third-party cookie problems.
