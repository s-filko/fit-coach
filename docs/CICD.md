# CI/CD Pipeline

Complete reference for the continuous integration and deployment infrastructure.

## 1. Architecture Overview

```
push dev  ──► GitHub Actions (Deploy Dev)  ──► SSH to VPS ──► deploy.sh dev
push main ──► GitHub Actions (Deploy Prod) ──► SSH to VPS ──► deploy.sh prod
PR to any ──► GitHub Actions (CI only)     ──► lint, format, types, tests
```

Each deploy workflow calls CI as a reusable workflow first. If CI fails, deploy is skipped.

On the VPS, `deploy.sh` pulls the latest code, builds Docker images, runs `docker compose up -d`,
executes database migrations (drizzle-kit push), and verifies health.

### Three environments

| Property | Local | Dev (VPS) | Prod (VPS) |
|---|---|---|---|
| Branch | any | `dev` | `main` |
| Domain | localhost:3000 | fitcoach-dev.filko.dev | fitcoach.filko.dev |
| NODE_ENV | development | development | production |
| Telegram bot | @FitCoachLocalBot | @FitCoachDevBot | @FitCoachBot |
| DB | local postgres | fitcoach-dev-db container | fitcoach-prod-db container |
| Env file | `apps/server/.env` + `apps/bot/.env` | `/srv/docker/fitcoach/.env.dev` | `/srv/docker/fitcoach/.env.prod` |
| Deploy trigger | manual | push to `dev` | push to `main` |

Three separate Telegram bots prevent polling conflicts — if two bot instances use the same
token simultaneously, both break.

## 2. File Structure

```
.github/workflows/
├── ci.yml              # CI checks (reusable workflow)
├── deploy-dev.yml      # Dev deploy (push to dev)
└── deploy-prod.yml     # Prod deploy (push to main)

deploy/
├── deploy.sh           # Deploy script executed on VPS via SSH
├── docker-compose.yml  # Shared compose file (parameterized by DEPLOY_ENV)
└── VPS_SETUP.md        # One-time VPS setup guide

apps/server/
├── Dockerfile          # Server image (node:22-slim + expect + tsx)
├── docker-entrypoint.sh # Runs drizzle push then starts server
├── .dockerignore       # Excludes tests, docs, .env from build context
└── public/             # Static files (webapp.html for Telegram Mini App)

apps/bot/
├── Dockerfile          # Bot image (multi-stage: tsup build -> node runtime)
└── .dockerignore       # Excludes docs, .env from build context

VERSION                 # Semver version (manually updated, e.g. 0.1.0)
.nvmrc                  # Node.js version pin (22)
```

## 3. GitHub Actions Workflows

### ci.yml

Runs lint, format check, type check, and unit tests for the server app.

**Triggers:**
- `pull_request` to `main` or `dev` — standalone CI check for PRs
- `workflow_call` — called by deploy workflows as a reusable workflow

**Does NOT trigger on push.** Deploy workflows already call CI internally. Without this,
every push would run CI twice (once standalone, once inside deploy).

**Key details:**
- `working-directory: apps/server` — all steps run in the server directory
- Node version from `.nvmrc` (22)
- `npm ci` with cache from `apps/server/package-lock.json`
- Generates `.env.test` with mock values (CI has no real database or LLM)
- Steps: `npm run lint` → `npm run format:check` → `npm run type-check` → `npm run test:unit`

### deploy-dev.yml

**Triggers:** push to `dev`, manual `workflow_dispatch`

**Concurrency:** group `deploy-dev`, `cancel-in-progress: true` — if a new push arrives
during deploy, the old deploy is cancelled.

**Flow:**
1. Calls `ci.yml` as reusable workflow
2. If CI passes, SSHs to VPS and runs `bash /srv/docker/fitcoach/deploy/deploy.sh dev`

### deploy-prod.yml

**Triggers:** push to `main`, manual `workflow_dispatch`

**Concurrency:** group `deploy-prod`, `cancel-in-progress: false` — prod deploys are never
cancelled mid-flight.

**Flow:** identical to dev, but runs `deploy.sh prod`.

### GitHub Secrets (required)

| Secret | Description |
|---|---|
| `VPS_HOST` | VPS hostname or IP address |
| `VPS_USER` | SSH user (e.g. `root`) |
| `VPS_SSH_KEY` | Private SSH key with access to VPS |

Uses `appleboy/ssh-action@v1` for SSH connection.

## 4. Deploy Script (deploy.sh)

Located at `deploy/deploy.sh`. Executed on the VPS by GitHub Actions via SSH.

### Full flow

```
1. Acquire deploy lock (/tmp/fitcoach.deploy.lock)
2. Verify .env.{dev|prod} exists
3. git fetch + checkout + reset --hard origin/{branch}
4. Export DEPLOY_ENV, DB_USER, DB_PASSWORD, DB_NAME
5. Create data/{env}/postgres directory
6. Backup database (pg_dump) if DB container is running
7. Read VERSION file, compute GIT_SHA and BUILD_TIME
8. Export GIT_SHA, APP_VERSION, BUILD_TIME
9. docker compose build (with build args)
10. docker compose up -d
11. Health check: 12 attempts × 5s = 60s timeout
12. On failure: print last 30 lines of server logs, exit 1
13. Prune Docker images and builder cache older than 72h
14. Release deploy lock (trap on EXIT)
```

### Deploy lock

- File: `/tmp/fitcoach.deploy.lock`
- **Global** — shared between dev and prod (prevents concurrent deploys)
- Auto-removes stale locks older than 600 seconds (10 minutes)
- Removed via `trap EXIT` on script completion (success or failure)

### Self-update race condition

`deploy.sh` updates itself via `git reset --hard` (step 3), but bash continues executing
the **old version** loaded into memory. This means:

- Changes to `deploy.sh` take effect on the **second** deploy after the commit
- Changes to `docker-compose.yml` take effect immediately (read from disk at step 9)
- Changes to `Dockerfile` and `docker-entrypoint.sh` take effect immediately (built at step 9)

This is a known and accepted limitation. Workaround: push a no-op commit to trigger
a second deploy.

## 5. Docker

### Server Dockerfile

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends expect postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts            # --ignore-scripts bypasses husky prepare
COPY src ./src
COPY public ./public                   # Static files (Telegram Mini App)
COPY tsconfig.json ./
COPY drizzle ./drizzle
COPY drizzle.config.ts ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ARG GIT_SHA=unknown                    # Passed from docker-compose build args
ARG APP_VERSION=0.0.0
ARG BUILD_TIME=unknown
ENV APP_GIT_SHA=$GIT_SHA
ENV APP_VERSION=$APP_VERSION
ENV APP_BUILD_TIME=$BUILD_TIME

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
```

**Why no tsup build:** The server's `tsup` config uses `nativeNodeModulesPlugin` which
conflicts with `.node.ts` file extensions in the codebase. The server runs directly
via `npx tsx src/index.ts` instead. This is a known issue to fix later.

**Why --ignore-scripts:** The `prepare` lifecycle script runs `husky`, which is a dev
tool and fails in Docker where git hooks are irrelevant.

**Why expect is installed:** `drizzle-kit push` shows interactive prompts for new tables
that cannot be auto-confirmed via stdin (it uses raw terminal mode). `expect` provides
a pseudo-TTY to answer these prompts automatically.

### Server Entrypoint (docker-entrypoint.sh)

```sh
#!/bin/sh
set -e

# expect script auto-confirms "created or renamed?" prompts
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

exec npx tsx src/index.ts
```

Runs on **every container start** (idempotent — drizzle push is a no-op if schema matches).

### Bot Dockerfile

Multi-stage build:
1. **Builder stage:** `npm ci` + `npm run build` (tsup → `dist/index.js`)
2. **Runtime stage:** `npm ci --omit=dev` + copies `dist/` → runs `node dist/index.js`

### docker-compose.yml

Three services, all parameterized by `DEPLOY_ENV`:

**db:**
- Image: `ankane/pgvector` (PostgreSQL with vector extension)
- Container: `fitcoach-{env}-db`
- Volume: `./data/{env}/postgres` (persistent, per-environment)
- Health check: `pg_isready`

**server:**
- Built from `apps/server/Dockerfile`
- Container: `fitcoach-{env}-server`
- Build args: `GIT_SHA`, `APP_VERSION`, `BUILD_TIME` (from deploy.sh exports)
- Env file: `../.env.{env}` (repo root)
- Environment overrides: `DB_HOST=db`, `DB_PORT=5432` (Docker internal)
- Networks: `default` + `nginx-proxy-manager_default` (for NPM access)
- Health check: `wget --spider http://127.0.0.1:3000/health`
- `stop_grace_period: 30s` for graceful shutdown
- Depends on: `db` (condition: `service_healthy`)

**bot:**
- Built from `apps/bot/Dockerfile`
- Container: `fitcoach-{env}-bot`
- Environment override: `SERVER_URL=http://server:3000` (Docker internal)
- Depends on: `server` (condition: `service_healthy`)

**Logging:** all services use `json-file` driver, max 10 MB × 3 files.

**Networks:** `nginx-proxy-manager_default` is external (must exist on VPS).

## 6. Versioning

Two version identifiers:

| Source | Example | How it's set |
|---|---|---|
| Semver (VERSION file) | `0.1.0` | Manually edit `VERSION` in repo root |
| Git SHA | `f291441` | Automatically from `git rev-parse --short HEAD` |

Both are passed as Docker build args → baked into ENV → read by `/health` endpoint.

### /health response

```json
{
  "status": "ok",
  "version": "0.1.0",
  "commit": "f291441",
  "buildTime": "2026-03-01T14:28:37Z",
  "env": "production",
  "uptime": 3600
}
```

Locally (no Docker): `version: "local"`, `commit: "dev"`, `buildTime: null`.

### How to bump version

1. Edit `VERSION` file (e.g. `0.1.0` → `0.2.0`)
2. Commit and push — version is baked into Docker image at next deploy

## 7. Database Migrations (Drizzle)

Uses **`drizzle-kit push`** (schema-first approach, no SQL migration files).

### How it works

- Schema defined in `apps/server/src/infra/db/schema.ts`
- On container start, entrypoint runs `drizzle-kit push --force`
- Drizzle compares TypeScript schema with actual database and applies diffs
- `--force` auto-confirms data loss statements (column type changes, etc.)
- Idempotent: if schema matches DB, it's a no-op

### Adding a new table

1. Add table definition to `schema.ts`
2. Commit and push
3. On deploy, `drizzle-kit push` detects new table → `expect` auto-confirms "create table"
4. Table is created

### Removing a table

`drizzle-kit push` does **NOT** drop tables that are removed from the schema.

1. Remove table from `schema.ts`
2. Commit and push (deploy succeeds, table remains in DB)
3. **Manually** drop the table on VPS:
   ```bash
   docker exec fitcoach-{env}-db psql -U {user} -d {dbname} -c 'DROP TABLE IF EXISTS {table}'
   ```

### Adding/removing columns

- Adding columns: automatic (push creates them)
- Removing columns: `drizzle-kit push` does **NOT** drop columns removed from schema
- Renaming: drizzle-kit prompts "created or renamed?" — `expect` picks "create" (first option),
  so renames are treated as drop + create. To truly rename, do it manually via SQL.

### Interactive prompts issue

`drizzle-kit push` uses `@clack/prompts` for interactive questions. These use raw terminal
mode (`process.stdin.setRawMode()`), so piping stdin does not work. The `expect` utility
creates a pseudo-TTY to handle this. Without it, the container hangs indefinitely on
new table creation.

## 8. Networking and HTTPS

### Nginx Proxy Manager (NPM)

Already running on VPS in Docker. Handles HTTPS termination and reverse proxying.

**Dev proxy host:**
- Domain: `fitcoach-dev.filko.dev`
- Forward: `fitcoach-dev-server:3000`
- SSL: Let's Encrypt, Force SSL

**Prod proxy host:**
- Domain: `fitcoach.filko.dev`
- Forward: `fitcoach-prod-server:3000`
- SSL: Let's Encrypt, Force SSL

### How it connects

The server container joins `nginx-proxy-manager_default` external Docker network.
NPM resolves container names via Docker DNS. No IP addresses or port mapping needed.

NPM proxy hosts must be configured manually through the NPM web UI.

## 9. Database Backups

- **Automatic:** `deploy.sh` runs `pg_dump` before every deploy (if DB container is running)
- **Location:** `/srv/docker/fitcoach/backups/`
- **Naming:** `{env}_{YYYYMMDD_HHMMSS}.sql`
- **Gitignored:** `backups/` is in `.gitignore`
- Backup failure is non-fatal (warning printed, deploy continues)

### Manual backup

```bash
docker exec fitcoach-{env}-db pg_dump -U {user} {dbname} > backup.sql
```

### Restore

```bash
cat backup.sql | docker exec -i fitcoach-{env}-db psql -U {user} {dbname}
```

## 10. Environment Variables

### Combined .env.{dev|prod} (used on VPS)

Both server and bot read from a single `.env.{env}` file at the repo root on VPS.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | — | `development` or `production` |
| `PORT` | Yes | — | Server port (always `3000`) |
| `HOST` | Yes | — | Bind address (always `0.0.0.0`) |
| `LOG_LEVEL` | No | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `DB_HOST` | Yes | — | `db` in Docker, `localhost` locally |
| `DB_PORT` | Yes | — | `5432` |
| `DB_USER` | Yes | — | Different per environment |
| `DB_PASSWORD` | Yes | — | Different per environment |
| `DB_NAME` | Yes | — | Different per environment |
| `BOT_API_KEY` | Yes | — | Shared secret between server and bot |
| `LLM_API_KEY` | Yes | — | LLM provider API key |
| `LLM_API_URL` | No | — | OpenAI-compatible API URL (omit for OpenAI) |
| `LLM_MODEL` | Yes | — | Model name (e.g. `google/gemini-3-flash-preview`) |
| `LLM_TEMPERATURE` | Yes | — | 0.0–2.0 |
| `TELEGRAM_TOKEN` | Yes | — | Bot token from @BotFather (unique per environment) |
| `SERVER_URL` | Yes | — | `http://server:3000` in Docker, `http://localhost:3000` locally |

**Docker overrides in docker-compose.yml:** `DB_HOST=db`, `DB_PORT=5432`, `SERVER_URL=http://server:3000`
override values from .env file — these ensure Docker-internal networking works regardless
of what's in the env file.

### Build-time variables (not in .env)

| Variable | Source | Description |
|---|---|---|
| `APP_GIT_SHA` | Docker build arg from deploy.sh | Short git commit hash |
| `APP_VERSION` | Docker build arg from VERSION file | Semver version |
| `APP_BUILD_TIME` | Docker build arg from deploy.sh | ISO 8601 UTC timestamp |

## 11. Known Limitations and Gotchas

### Self-update race condition
Changes to `deploy.sh` take effect on the second deploy, not the first.
The script updates itself via `git reset --hard`, but bash keeps the old version in memory.

### Server tsup build broken
`tsup` in the server uses `nativeNodeModulesPlugin` which misinterprets `.node.ts` file
extensions as native Node modules. Server runs via `tsx` in Docker instead of a compiled build.
This adds ~2-3s to container startup but is functionally equivalent.

### drizzle-kit push hangs without expect
Creating new tables triggers an interactive "created or renamed?" prompt. Without a
pseudo-TTY (provided by `expect`), the process hangs indefinitely.

### Global deploy lock
Dev and prod deployments share a single lock file. They cannot run simultaneously.
If one deploy takes >10 minutes, the lock is considered stale and removed.

### Telegram bot polling conflicts
Running two bot instances with the same token causes both to fail. Each environment
must use a different bot token.

### force-push to dev
Safe — triggers a new deploy. History rewriting on `dev` is acceptable.
Never force-push to `main`.

### NPM manual configuration
Proxy hosts in Nginx Proxy Manager must be created manually through the web UI.
There is no automated provisioning.

### Backup on first deploy
First deploy has no database to back up — the warning "Backup failed" is expected
and harmless.

## 12. Checklists

### Add a new database table
1. Add table definition to `apps/server/src/infra/db/schema.ts`
2. Commit and push to `dev` (or `main`)
3. Deploy runs → drizzle-kit push → `expect` auto-confirms → table created
4. Verify: `docker exec fitcoach-{env}-db psql -U {user} -d {dbname} -c '\dt'`

### Remove a database table
1. Remove from `schema.ts`, commit, push
2. Deploy succeeds (drizzle push ignores missing tables)
3. Manually: `docker exec fitcoach-{env}-db psql -U {user} -d {dbname} -c 'DROP TABLE {name}'`

### Update environment variables on VPS
1. SSH to VPS: `ssh filko.dev`
2. Edit: `nano /srv/docker/fitcoach/.env.{dev|prod}`
3. Restart affected containers:
   ```bash
   cd /srv/docker/fitcoach
   export DEPLOY_ENV={dev|prod}
   eval "$(grep -E '^(DB_USER|DB_PASSWORD|DB_NAME)=' .env.${DEPLOY_ENV})"
   export DB_USER DB_PASSWORD DB_NAME
   docker compose -f deploy/docker-compose.yml -p fitcoach-${DEPLOY_ENV} up -d
   ```

### Bump application version
1. Edit `VERSION` file (e.g. `0.1.0` → `0.2.0`)
2. Commit and push
3. Next deploy bakes new version into Docker image
4. Verify: `curl https://fitcoach-{domain}/health`

### Rollback a deploy
1. `git revert HEAD` (or `git reset --hard {sha}` for dev)
2. Push to trigger redeploy with previous code
3. If database changes need reverting, restore from backup manually

### View logs
```bash
# Specific service
docker compose -f deploy/docker-compose.yml -p fitcoach-{env} logs -f server
docker compose -f deploy/docker-compose.yml -p fitcoach-{env} logs -f bot
docker compose -f deploy/docker-compose.yml -p fitcoach-{env} logs -f db

# All services
docker compose -f deploy/docker-compose.yml -p fitcoach-{env} logs -f

# Last N lines
docker compose -f deploy/docker-compose.yml -p fitcoach-{env} logs --tail=50 server
```

### Connect to database
```bash
docker exec -it fitcoach-{env}-db psql -U {user} -d {dbname}
```

### Check disk space
```bash
df -h
docker system df
docker system prune -a    # WARNING: removes all unused images/containers
```

### Manual deploy (without GitHub Actions)
```bash
ssh filko.dev
cd /srv/docker/fitcoach
bash deploy/deploy.sh {dev|prod}
```

### Trigger deploy without code changes
Use `workflow_dispatch` from the GitHub Actions UI, or push an empty commit:
```bash
git commit --allow-empty -m "chore: trigger deploy" && git push
```

## 13. VPS Directory Structure

```
/srv/docker/fitcoach/              # Git repo root
├── .env.dev                       # Dev environment (gitignored, created manually)
├── .env.prod                      # Prod environment (gitignored, created manually)
├── VERSION                        # Semver version
├── data/
│   ├── dev/postgres/              # Dev DB persistent data
│   └── prod/postgres/             # Prod DB persistent data
├── backups/                       # Auto-created pg_dump files (gitignored)
├── deploy/
│   ├── deploy.sh                  # Deploy script
│   ├── docker-compose.yml         # Shared compose
│   └── VPS_SETUP.md               # Setup guide
├── apps/
│   ├── server/                    # Server source + Dockerfile
│   └── bot/                       # Bot source + Dockerfile
└── .github/workflows/             # CI/CD workflows
```

Docker containers:

| Container | Dev | Prod |
|---|---|---|
| Database | fitcoach-dev-db | fitcoach-prod-db |
| Server | fitcoach-dev-server | fitcoach-prod-server |
| Bot | fitcoach-dev-bot | fitcoach-prod-bot |
