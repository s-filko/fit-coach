#!/bin/bash
set -euo pipefail

DEPLOY_ENV=${1:?Usage: deploy.sh <dev|prod>}
REPO_DIR="/srv/docker/fitcoach"
BRANCH=$([ "$DEPLOY_ENV" = "prod" ] && echo "main" || echo "dev")
PROJECT="fitcoach-${DEPLOY_ENV}"
COMPOSE_FILE="deploy/docker-compose.yml"

cd "$REPO_DIR"

# --- Deploy lock (global — prevents concurrent dev/prod deploys) ---
LOCKFILE="/tmp/fitcoach.deploy.lock"
if [ -f "$LOCKFILE" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCKFILE" 2>/dev/null || stat -f %m "$LOCKFILE") ))
  if [ "$LOCK_AGE" -gt 600 ]; then
    echo "Stale lock detected (${LOCK_AGE}s old), removing"
    rm -f "$LOCKFILE"
  else
    echo "ERROR: Deploy already in progress (lock age: ${LOCK_AGE}s)"
    exit 1
  fi
fi
trap 'rm -f "$LOCKFILE"' EXIT
touch "$LOCKFILE"

# --- Check env file ---
ENV_FILE=".env.${DEPLOY_ENV}"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} not found in ${REPO_DIR}"
  echo "Create it with the required environment variables (see apps/server/.env.example)"
  exit 1
fi

# --- Pull latest code ---
echo "==> Pulling branch: ${BRANCH}"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"

# --- Export compose variables ---
export DEPLOY_ENV
export DB_USER DB_PASSWORD DB_NAME
eval "$(grep -E '^(DB_USER|DB_PASSWORD|DB_NAME)=' "$ENV_FILE")"

# --- Create data directory ---
mkdir -p "data/${DEPLOY_ENV}/postgres"

# --- Backup database (if running) ---
if docker compose -f "$COMPOSE_FILE" -p "$PROJECT" ps db --status running -q 2>/dev/null | grep -q .; then
  echo "==> Backing up database before deploy"
  BACKUP_DIR="${REPO_DIR}/backups"
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="${BACKUP_DIR}/${DEPLOY_ENV}_$(date +%Y%m%d_%H%M%S).sql"
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT" exec -T db \
    pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_FILE" 2>/dev/null && \
    echo "Backup saved: ${BACKUP_FILE}" || \
    echo "WARNING: Backup failed (database may be empty, continuing)"
fi

# --- Capture container logs before the recreate destroys them ---
# Rationale and contract: docs/LOGGING_GUIDE.md § "Why a `volumes:` mount cannot fix a
# lost container log" and § "The fix: capture before recreate, in `deploy.sh`".
# docker's json-file driver (deploy/docker-compose.yml's `logging:` block) ties
# each log file to the CONTAINER's own id, under dockerd's data root — a path
# no service-level `volumes:` mount can redirect. `up -d` below gives server
# and bot NEW container ids; the OLD containers are removed, and dockerd's
# log directory goes with them. That is what actually erased the 2026-09-21
# 09:25 morning's evidence — not a missing volume mount. `docker compose logs`
# reads whatever json-file still has retained (10m x 3 files) and writing it
# to a host file BEFORE the recreate is the fix. A capture failure must not
# abort the deploy (same guard as the DB backup above); a service that is not
# running yet (first deploy) is skipped, not an error.
LOG_DIR="${REPO_DIR}/logs/${DEPLOY_ENV}"
mkdir -p "$LOG_DIR"
LOG_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
for SERVICE in server bot; do
  if docker compose -f "$COMPOSE_FILE" -p "$PROJECT" ps "$SERVICE" --status running -q 2>/dev/null | grep -q .; then
    LOG_FILE="${LOG_DIR}/${SERVICE}_${LOG_TIMESTAMP}.log"
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT" logs --no-color "$SERVICE" > "$LOG_FILE" 2>&1 && \
      echo "Captured ${SERVICE} logs: ${LOG_FILE}" || \
      echo "WARNING: Log capture failed for ${SERVICE} (continuing)"
  fi
done

# --- Build and deploy ---
GIT_SHA=$(git rev-parse --short HEAD)
APP_VERSION=$(cat VERSION 2>/dev/null || echo "0.0.0")
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export GIT_SHA APP_VERSION BUILD_TIME

echo "==> Building images (v${APP_VERSION} commit: ${GIT_SHA})"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT" build

# --- Apply database migrations (before starting new containers) ---
# dev already matches schema.ts, so it is stamped through the whole chain;
# prod is stamped at the baseline only, so the catch-up migrations really run.
# Both steps are idempotent: once history exists the stamp is a no-op and
# migrate applies only genuinely new files.
if [ "$DEPLOY_ENV" = "prod" ]; then
  STAMP_THROUGH="0000_baseline"
else
  STAMP_THROUGH=$(node -e "const j=require('./apps/server/drizzle/meta/_journal.json');console.log(j.entries[j.entries.length-1].tag)")
fi
export STAMP_THROUGH

# `docker compose build` tags the built image <project>-<service>:latest; use that,
# NOT `docker compose images -q server` — the latter resolves the image of the
# *running* (old) container, which lacks files added in this deploy.
MIGRATE_IMAGE="${PROJECT}-server:latest"
export MIGRATE_IMAGE

echo "==> Applying migrations (stamp through ${STAMP_THROUGH})"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT" --profile migrate run --rm migrate

echo "==> Starting services"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT" up -d

# --- Health check ---
CONTAINER="fitcoach-${DEPLOY_ENV}-server"
echo "==> Waiting for health check (${CONTAINER})..."
HEALTH_OK=false
for i in $(seq 1 12); do
  sleep 5
  if docker exec "$CONTAINER" wget --spider -q http://127.0.0.1:3000/health 2>/dev/null; then
    HEALTH_OK=true
    break
  fi
  echo "  attempt ${i}/12..."
done

if [ "$HEALTH_OK" = true ]; then
  echo "==> Deploy ${DEPLOY_ENV} OK (v${APP_VERSION} commit: ${GIT_SHA})"
else
  echo "==> ERROR: Health check failed after 60s"
  echo "Container logs:"
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT" logs --tail=30 server
  exit 1
fi

# --- Cleanup old Docker resources ---
echo "==> Cleaning up old images"
docker image prune -f --filter "until=72h" > /dev/null 2>&1 || true
docker builder prune -f --filter "until=72h" > /dev/null 2>&1 || true

echo "==> Done"
