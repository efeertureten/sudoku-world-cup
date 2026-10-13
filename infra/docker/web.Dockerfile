# syntax=docker/dockerfile:1.7
# Builds the React client and serves it with Caddy, which also reverse-proxies
# /api and /socket.io to the server so everything shares one origin.

FROM node:26-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @swcup/web...
COPY tsconfig.base.json ./
COPY content content
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @swcup/web build

FROM caddy:2-alpine AS runtime
COPY infra/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 8080
