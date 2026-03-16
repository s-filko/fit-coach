#!/bin/sh
set -e

echo "Ensuring pgvector extension..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || echo "WARN: could not create vector extension (may already exist)"

echo "Running database schema push..."
expect <<'EXPECT_SCRIPT'
set timeout 120
spawn npx drizzle-kit push --force
expect {
  -re "created or renamed" {
    send "\r"
    exp_continue
  }
  eof
}
lassign [wait] pid spawnid os_error value
exit $value
EXPECT_SCRIPT
echo "Schema push complete."

echo "Seeding exercises (skips existing)..."
npx tsx src/infra/db/seeds/exercises.seed.ts || echo "WARN: exercise seed failed (non-fatal)"

echo "Seeding exercise embeddings (skips if already present)..."
npx tsx src/infra/db/seeds/seed-embeddings.ts || echo "WARN: embedding seed failed (non-fatal)"

echo "Starting server..."
exec npx tsx src/index.ts
