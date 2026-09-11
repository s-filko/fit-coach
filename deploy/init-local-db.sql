-- Idempotent local DB creation. Run via: psql -U postgres -f deploy/init-local-db.sql
-- Requires psql client (\gexec is a psql meta-command, not standard SQL).
SELECT 'CREATE DATABASE fitcoach_dev'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fitcoach_dev')\gexec
