#!/bin/sh
set -e

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

echo "Starting server..."
exec npx tsx src/index.ts
