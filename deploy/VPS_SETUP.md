# VPS Setup Guide

One-time setup for deploying Fit Coach to a VPS.

## Prerequisites

- VPS with 4 GB RAM, 2 CPU, 40 GB disk (Ubuntu 22.04+ or Debian 12+)
- Docker and Docker Compose installed
- Nginx Proxy Manager running in Docker
- GitHub repository with deploy key

## 1. Clone repository

```bash
cd /srv/docker
git clone git@github.com:s-filko/fit-coach.git fitcoach
cd fitcoach
```

For `git pull` to work, add a deploy key to GitHub:
```bash
ssh-keygen -t ed25519 -C "fitcoach-vps-deploy"
cat ~/.ssh/id_ed25519.pub
```
Add the public key at: GitHub repo -> Settings -> Deploy keys -> Add deploy key (read-only).

## 2. Create environment files

```bash
cd /srv/docker/fitcoach

# Dev environment
cp apps/server/.env.example .env.dev
nano .env.dev

# Prod environment (later)
cp apps/server/.env.example .env.prod
nano .env.prod
```

Required variables in each `.env.{dev|prod}`:
```bash
NODE_ENV=development          # or production
PORT=3000
HOST=0.0.0.0
DB_HOST=db                    # Docker service name, NOT localhost
DB_PORT=5432
DB_USER=fitcoach
DB_PASSWORD=<strong-password>  # Different for dev and prod!
DB_NAME=fitcoach
BOT_API_KEY=<shared-secret>
LLM_API_KEY=<your-llm-key>
LLM_API_URL=<provider-url>
LLM_MODEL=<model-name>
LLM_TEMPERATURE=0.7
TELEGRAM_TOKEN=<bot-token>    # Different bot for dev and prod!
SERVER_URL=http://server:3000 # Docker internal URL
LOG_LEVEL=info
```

Important:
- `DB_HOST=db` — Docker internal hostname, NOT localhost
- `SERVER_URL=http://server:3000` — Docker internal URL
- Use different `DB_PASSWORD` and `TELEGRAM_TOKEN` for dev and prod

## 3. First deploy

```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh dev
```

This will:
- Checkout the `dev` branch
- Create `data/dev/postgres/` for database storage
- Build Docker images
- Run database schema push (drizzle-kit)
- Start db, server, and bot containers
- Run health check

Verify:
```bash
docker ps | grep fitcoach
# Should show: fitcoach-dev-db, fitcoach-dev-server, fitcoach-dev-bot
```

## 4. Configure NPM proxy host

In the NPM web UI, create a proxy host:

**Dev:**
- Domain: `fitcoach-dev.filko.dev`
- Forward hostname: `fitcoach-dev-server`
- Forward port: `3000`
- SSL: Request a new Let's Encrypt certificate, Force SSL

**Prod (later):**
- Domain: `fitcoach.filko.dev`
- Forward hostname: `fitcoach-prod-server`
- Forward port: `3000`
- SSL: Request a new Let's Encrypt certificate, Force SSL

The server container joins `nginx-proxy-manager_default` network automatically,
so NPM can reach it by container name.

### Telegram Mini App setup

1. Open @BotFather in Telegram
2. Send `/newapp` and select your bot
3. Set the Web App URL: `https://fitcoach-dev.filko.dev/public/webapp.html`
4. Optionally add a Menu Button via `/setmenubutton`

## 5. GitHub Actions (optional)

For automatic deploys on push, add these GitHub Secrets:
- `VPS_SSH_KEY` — private key with SSH access to VPS
- `VPS_HOST` — VPS hostname or IP
- `VPS_USER` — SSH user (e.g. `root`)

## 6. Directory structure on VPS

```
/srv/docker/fitcoach/          # Git repo root
├── .env.dev                   # Dev environment (gitignored)
├── .env.prod                  # Prod environment (gitignored)
├── data/
│   ├── dev/postgres/          # Dev DB data
│   └── prod/postgres/         # Prod DB data
├── backups/                   # DB backups before deploy
├── deploy/
│   ├── docker-compose.yml     # Shared compose (uses DEPLOY_ENV)
│   └── deploy.sh              # Deploy script
├── apps/
│   ├── server/                # Server source + Dockerfile
│   └── bot/                   # Bot source + Dockerfile
└── ...
```

## View logs

```bash
cd /srv/docker/fitcoach

# Dev server logs
docker compose -f deploy/docker-compose.yml -p fitcoach-dev logs -f server

# Dev bot logs
docker compose -f deploy/docker-compose.yml -p fitcoach-dev logs -f bot

# All dev services
docker compose -f deploy/docker-compose.yml -p fitcoach-dev logs -f

# Prod (replace dev with prod)
docker compose -f deploy/docker-compose.yml -p fitcoach-prod logs -f
```

## Troubleshooting

### Container won't start
```bash
docker compose -f deploy/docker-compose.yml -p fitcoach-dev logs server
```
Common causes: missing env vars, wrong DB_HOST, invalid API keys.

### Database connection refused
Make sure `DB_HOST=db` (not `localhost`) in the env file.

### Disk space
```bash
df -h
docker system df
docker system prune -a  # WARNING: removes all unused images
```

