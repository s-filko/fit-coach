# Claude Context — Fit Coach

## Where the environments live

**Do NOT run dev services locally.** All running environments (dev + prod) are on the VPS:

- `ssh filko.dev` → root@host.filko.dev (94.130.168.191) — separate from the Khadas home server (`kh`)
- Repo on VPS: `/srv/docker/fitcoach`
- Containers: `fitcoach-dev-{db,server,bot}`, `fitcoach-prod-{db,server,bot}`
- Env files on VPS: `/srv/docker/fitcoach/.env.dev` and `.env.prod` (gitignored, contain all secrets)
- Public endpoints: `https://fitcoach-dev.filko.dev` / `https://fitcoach.filko.dev` (NPM + Let's Encrypt)

## Deploy

```bash
ssh filko.dev
cd /srv/docker/fitcoach
./deploy/deploy.sh dev    # dev branch
./deploy/deploy.sh prod   # main branch
```

`deploy.sh` pulls the branch from origin, backs up the DB, rebuilds images, runs health check.
Local commits must be **pushed to origin** before deploying — the script does `git reset --hard origin/<branch>`.

## Logs / status

```bash
docker logs fitcoach-dev-server --tail 50
docker logs fitcoach-dev-bot --tail 50
docker compose -f deploy/docker-compose.yml -p fitcoach-dev ps
curl https://fitcoach-dev.filko.dev/health   # → 200
```

## LLM

- Provider: OpenRouter (`https://openrouter.ai/api/v1/`) with **BYOK**. Attached provider keys:
  - **Z.AI — subscription** (paid subscription)
  - **Google AI Studio — prepaid PAYG** (pay-as-you-go)
- Current model (dev, since 2026-09-09): `z-ai/glm-5.3` (flagship; `z-ai/glm-5.3-flash` = cheaper variant). Prod still on `google/gemini-3-flash-preview`
- BYOK requests don't burn OpenRouter credits (`is_byok: true` in usage); check with `curl https://openrouter.ai/api/v1/key -H "Authorization: Bearer <key>"`
- Alternative keys/models are commented in local `apps/server/.env` with status annotations
- Deployed API (branch dev @56ca086) routes: `/api/user`, `/api/chat` (no `/bot` prefix — that's newer local code); auth header `X-Api-Key: <BOT_API_KEY>`

## Bots

- Dev: `@MyFitAiCoachDevBot` (token in `.env.dev`)
- Prod: separate bot (token in `.env.prod`)
- Telegram polling errors (429/502) in old logs are transient Telegram-side outages, not config problems

## Gotchas

- **Bot can hang silently**: node-telegram-bot-api polling dies on persistent Telegram errors (502/ECONNRESET, seen 2026-08-08) without exiting the process — Docker restart policy never fires, bot just stops consuming updates. Fix = `docker restart fitcoach-dev-bot`. Proper fix (watchdog on `polling_error` → process exit) not yet implemented
- **Bot logs only errors** — a working message flow shows just one "incoming message" INFO line and nothing else. Don't mistake this for a hang; verify via server logs (`docker logs fitcoach-dev-server`) looking for POST /api/user + /api/chat
- `deploy/docker-compose.yml` on the VPS has an uncommitted local change (`mem_limit` on db/server/bot) — deploy.sh's `git reset --hard` will wipe it; commit it or it will be lost
- Webapp build is part of the server Docker image (`apps/server/Dockerfile`)
- `docker restart` does NOT re-read `env_file` — to apply env changes: `DEPLOY_ENV=dev docker compose -f deploy/docker-compose.yml -p fitcoach-dev up -d <service>` (with DB_* vars exported from .env.dev, like deploy.sh does)

## Local development

- `docker compose up -d db` (root compose, Postgres on :5432, data in `data/local/postgres`)
- `cd apps/server && npm run dev` → http://localhost:3000 (logs tee'd to `logs/server.log`)
- `cd apps/webapp && npm run dev` → http://localhost:5173/public/webapp/ (vite, base path `/public/webapp/`)
- **Never run `npm run drizzle:push` blindly** — it always offers to DELETE the `checkpoints*` tables (LangGraph PostgresSaver runtime storage, not in schema.ts). Answer "No"; the schema tables themselves are usually already in sync
- Local bot would use the third Telegram token in `apps/server/.env` (8587616606, separate local bot) — start with `cd apps/bot && npm run serve-bot` if needed; not running by default

## Rules

- Respond in Russian (user preference)
- Docs in this repo are English-only; unique IDs (INV-*, BR-*, S-*, AC-*) — see `docs/DOCUMENTATION_GUIDE.md`
