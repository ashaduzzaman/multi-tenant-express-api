#!/usr/bin/env bash
# Wipes the postgres data volume and re-applies init scripts + migrations + seed.
# DEV ONLY. Refuses to run if NODE_ENV=production.

set -euo pipefail

if [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "❌ Refusing to db:reset in production"
  exit 1
fi

echo "🗑  Stopping postgres and deleting data volume…"
docker compose down -v

echo "🐘 Starting fresh postgres…"
docker compose up -d postgres

echo "⏳ Waiting for postgres to be ready…"
until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
  sleep 1
done
sleep 2  # let init scripts finish

echo "📦 Running migrations…"
pnpm db:migrate

echo "🌱 Seeding…"
pnpm db:seed

echo "✅ Database reset complete"
