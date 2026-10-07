#!/bin/sh
# One-shot setup run by the "migrate" service in docker-compose.yml.
# Safe to run on every start: each step skips what's already there.
set -e

echo "PrintQ: applying database migrations"
npx drizzle-kit migrate

echo "PrintQ: adding the printer and default lab hours (if missing)"
npx tsx scripts/printq-seed.ts

if [ "$PRINTQ_DEMO" = "true" ]; then
  echo "PrintQ: demo mode, adding demo people and bookings (if missing)"
  npx tsx scripts/printq-demo-seed.ts
fi

echo "PrintQ: database ready"
