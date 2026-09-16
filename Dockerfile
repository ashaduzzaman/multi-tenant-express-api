# syntax=docker/dockerfile:1.7

# ---- Base ----
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@12 --activate
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod=false

# ---- Build ----
FROM base AS build
# `prisma generate` parses schema.prisma's datasource block, which reads
# DATABASE_ADMIN_URL via env() — it doesn't need to actually connect, but
# the var must resolve to *something* URL-shaped or generate fails. This is
# a placeholder, never used for a real connection at this stage.
ENV DATABASE_ADMIN_URL="postgresql://build:build@localhost:5432/build"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma client must be generated before both `build` (tsc needs its types)
# and `prune` (the generated client has to already exist in node_modules
# before we strip devDependencies, since `prisma` itself is a devDependency).
RUN pnpm exec prisma generate && \
    pnpm run build && \
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
