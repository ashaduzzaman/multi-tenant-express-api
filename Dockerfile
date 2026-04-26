# syntax=docker/dockerfile:1.7

# ---- Base ----
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod=false

# ---- Build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build && \
    pnpm prune --prod

# ---- Runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs node-app

WORKDIR /app

COPY --from=build --chown=node-app:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=node-app:nodejs /app/dist ./dist
COPY --from=build --chown=node-app:nodejs /app/package.json ./package.json
COPY --from=build --chown=node-app:nodejs /app/db ./db

USER node-app

EXPOSE 3000

# Use Node's native env-file flag in prod via env vars instead of .env file
CMD ["node", "dist/index.js"]
