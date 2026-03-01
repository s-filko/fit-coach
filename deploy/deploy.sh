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

# --- Build and deploy ---
GIT_SHA=$(git rev-parse --short HEAD)
echo "==> Building images (commit: ${GIT_SHA})"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT" build

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
  echo "==> Deploy ${DEPLOY_ENV} OK (commit: ${GIT_SHA})"
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
