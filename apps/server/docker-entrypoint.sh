#!/bin/sh
set -e

echo "Running database schema push..."
npx drizzle-kit push --force
echo "Schema push complete."

echo "Starting server..."
exec npx tsx src/index.ts
