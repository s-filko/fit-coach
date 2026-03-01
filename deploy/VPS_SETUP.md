# VPS Setup Guide

One-time setup for deploying Fit Coach to a VPS.

## Prerequisites

- VPS with 4 GB RAM, 2 CPU, 40 GB disk (Ubuntu 22.04+ or Debian 12+)
- Root or sudo access
- GitHub repository with deploy key

## 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
```

Verify:
```bash
docker --version
docker compose version
```

## 2. Create deploy user

```bash
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
```

## 3. Configure SSH access

On your local machine, generate a key pair for GitHub Actions:
```bash
ssh-keygen -t ed25519 -C "github-actions-fitcoach" -f ~/.ssh/fitcoach_deploy
```

Copy the public key to VPS:
```bash
ssh-copy-id -i ~/.ssh/fitcoach_deploy.pub deploy@YOUR_VPS_IP
```

Add the **private key** as a GitHub secret:
- Go to GitHub repo -> Settings -> Secrets and variables -> Actions
- Add secret `VPS_SSH_KEY` with the contents of `~/.ssh/fitcoach_deploy`
- Add secret `VPS_HOST` with your VPS IP address
- Add secret `VPS_USER` with value `deploy`

## 4. Clone repository

```bash
sudo -u deploy bash
cd /opt
sudo mkdir fitcoach && sudo chown deploy:deploy fitcoach
git clone git@github.com:YOUR_USERNAME/fit_coach.git /opt/fitcoach
```

For `git pull` to work, add a deploy key to GitHub:
```bash
ssh-keygen -t ed25519 -C "fitcoach-vps-deploy" -f /home/deploy/.ssh/id_ed25519
cat /home/deploy/.ssh/id_ed25519.pub
```
Add the public key at: GitHub repo -> Settings -> Deploy keys -> Add deploy key (read-only).

## 5. Create environment files

```bash
cd /opt/fitcoach

# Dev environment
cp apps/server/.env.example .env.dev
# Edit .env.dev: set NODE_ENV=development, DB credentials, API keys, dev bot token

# Prod environment
cp apps/server/.env.example .env.prod
# Edit .env.prod: set NODE_ENV=production, DB credentials, API keys, prod bot token
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
- `DB_HOST=db` (Docker internal hostname, NOT localhost)
- `SERVER_URL=http://server:3000` (Docker internal URL)
- Use different `DB_PASSWORD` for dev and prod
- Use different `TELEGRAM_TOKEN` for dev and prod

## 6. Connect to Nginx Proxy Manager network

Find the Docker network used by your NPM instance:
```bash
docker network ls
# Look for something like: npm_default, proxy-network, etc.
```

Add the network name to both `.env.dev` and `.env.prod`:
```bash
NPM_NETWORK=npm_default   # Replace with your actual NPM network name
```

### Configure NPM proxy hosts

In the NPM web UI, create proxy hosts:

**Prod:**
- Domain: `fitcoach.example.com`
- Forward hostname: `fitcoach-prod-server-1`
- Forward port: `3000`
- SSL: Request a new Let's Encrypt certificate, Force SSL

**Dev:**
- Domain: `dev.fitcoach.example.com`
- Forward hostname: `fitcoach-dev-server-1`
- Forward port: `3000`
- SSL: Request a new Let's Encrypt certificate, Force SSL

Note: the container hostname follows the pattern `{project}-server-1`.
After first deploy, verify with `docker ps` to confirm the exact name.

### Telegram Mini App setup

1. Open @BotFather in Telegram
2. Send `/newapp` and select your bot
3. Set the Web App URL: `https://fitcoach.example.com/public/webapp.html`
4. Optionally add a Menu Button via `/setmenubutton`

## 7. Configure firewall

```bash
# SSH
ufw allow 22/tcp

# HTTP + HTTPS (NPM handles TLS)
ufw allow 80/tcp
ufw allow 443/tcp

ufw enable
```

## 8. Make deploy script executable

```bash
chmod +x /opt/fitcoach/deploy/deploy.sh
```

## 9. Test deployment

```bash
sudo -u deploy bash
cd /opt/fitcoach
./deploy/deploy.sh dev
```

Check:
```bash
# Via NPM domain:
curl https://fitcoach.example.com/health
# Should return: {"status":"ok"}

# Mini App stub:
curl https://fitcoach.example.com/public/webapp.html

# Direct (from VPS, bypassing NPM):
docker compose -f deploy/docker-compose.yml -p fitcoach-dev exec server wget -qO- http://localhost:3000/health
```

## 10. View logs

```bash
# Server logs
docker compose -f deploy/docker-compose.yml -p fitcoach-dev logs -f server

# Bot logs
docker compose -f deploy/docker-compose.yml -p fitcoach-prod logs -f bot

# All services
docker compose -f deploy/docker-compose.yml -p fitcoach-prod logs -f
```

## Troubleshooting

### Container won't start
```bash
docker compose -f deploy/docker-compose.yml -p fitcoach-dev logs server
```
Common causes: missing env vars, wrong DB_HOST, invalid API keys.

### Database connection refused
Make sure `DB_HOST=db` (not `localhost`) in the env file. The `db` hostname resolves inside the Docker network.

### Port already in use
```bash
lsof -i :3000
docker ps  # Check for orphan containers
```

### Disk space
```bash
df -h
docker system df
docker system prune -a  # WARNING: removes all unused images
```
