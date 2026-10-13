# syntax=docker/dockerfile:1.7
# Builds the API/WebSocket server and the puzzle worker into one image.
# The worker is the same image started with `node dist/worker.js`.

FROM node:26-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @swcup/server...
COPY tsconfig.base.json ./
COPY content content
COPY packages packages
COPY apps/server apps/server
RUN pnpm --filter @swcup/server build

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The bundle inlines every JavaScript dependency; only the native argon2 binding is installed here.
RUN npm install --omit=dev --no-audit --no-fund @node-rs/argon2@2.2.2 && npm cache clean --force
COPY --from=build /repo/apps/server/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/healthz || exit 1
CMD ["node", "--enable-source-maps", "dist/index.js"]
