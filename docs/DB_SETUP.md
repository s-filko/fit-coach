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
DB_USER=user_name
DB_PASSWORD=secret
DB_NAME=fitcoach
```

Keep `BOT_API_KEY` in the same file.

## Test database
Create `apps/server/.env` with the same credentials but a different port or DB name, e.g.:

```
DB_HOST=localhost
DB_PORT=5432
DB_USER=user_name
DB_PASSWORD=secret
DB_NAME=fitcoach_dev
```

Run a separate DB for tests by keeping docker-compose mapping 5432:5432 (container:5432 -> host:5432), and run tests with `NODE_ENV=test`.

## Migrations (later)
We will add drizzle-kit config and migrations after initial wiring. Schema is defined in `infra/db/schema.ts` with proper migrations.
