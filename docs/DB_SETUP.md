# Database Setup (PostgreSQL + pgvector)

## Start DB

```bash
docker compose up -d db
```

Compose provides:
- host: localhost
- port: 5432
- user: postgres
- password: postgres
- db: fitcoach

## Server env
Create/update `apps/server/.env` (used by Fastify app):

```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=fitcoach
```

Keep `BOT_API_KEY` in the same file.

## Test database
Create `apps/server/.env.test` with the same credentials but a different port or DB name, e.g.:

```
DB_HOST=localhost
DB_PORT=5433
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=fitcoach_test
```

Run a separate DB for tests by changing docker-compose to map 5433:5432 (or use a different local instance), and run tests with `NODE_ENV=test`.

## Migrations (later)
We will add drizzle-kit config and migrations after initial wiring. For now, schema comes from legacy and will be ported to new `infra/db/schema.ts` with proper migrations next.
