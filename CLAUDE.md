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

`deploy.sh` pulls the branch from origin, backs up the DB, rebuilds images, applies
DB migrations (stamp + `drizzle-kit migrate`) **before** starting containers, runs health check.
A failed migration aborts the deploy — old containers keep serving.
Local commits must be **pushed to origin** before deploying — the script does `git reset --hard origin/<branch>`.

## Logs / status

```bash
docker logs fitcoach-dev-server --tail 50
docker logs fitcoach-dev-bot --tail 50
docker compose -f deploy/docker-compose.yml -p fitcoach-dev ps
curl https://fitcoach-dev.filko.dev/health   # → 200
```

## LLM

- **Dev (since 2026-09-14): direct Z.AI** `https://api.z.ai/api/coding/paas/v4/` with the **Z.AI subscription token** (the same subscription that powers Claude Code), model `glm-5.3`. Zero per-token cost; quota shared with Claude Code sessions; token rotates on subscription renewal.
- **Z.AI subscription is unusable through OpenRouter** (verified 2026-09-13): it only authorizes the coding endpoint, OpenRouter BYOK calls the standard one — GLM via OpenRouter is billed to credits at list price (`is_byok: false`). Keep this in mind before switching back.
- **Prod: OpenRouter** (`https://openrouter.ai/api/v1/`) with Google AI Studio PAYG BYOK — that BYOK **does** work (`is_byok: true`), model `google/gemini-3-flash-preview`.
- Check per-request BYOK via `usage.is_byok` in a completion response, not via `curl /key` alone (byok_usage lags and missed the 09-09 mis-annotation).
- Alternative keys/models are commented in local `apps/server/.env` with status annotations
- Deployed API routes: `/api/bot/user`, `/api/bot/chat` (with `/bot` prefix, both dev and prod since 2026-09-11); auth header `X-Api-Key: <BOT_API_KEY>`

## Bots

- Dev: `@MyFitAiCoachDevBot` (token in `.env.dev`)
- Prod: `@MyFitAiCoachBot` (token in `.env.prod`)
- Telegram polling errors (429/502) in old logs are transient Telegram-side outages, not config problems

## Gotchas

- **Bot can hang silently**: node-telegram-bot-api polling dies on persistent Telegram errors (502/ECONNRESET, seen 2026-08-08) without exiting the process — Docker restart policy never fires, bot just stops consuming updates. Fix = `docker restart fitcoach-dev-bot`. Proper fix (watchdog on `polling_error` → process exit) not yet implemented
- **Bot logs only errors** — a working message flow shows just one "incoming message" INFO line and nothing else. Don't mistake this for a hang; verify via server logs (`docker logs fitcoach-dev-server`) looking for POST /api/bot/user + /api/bot/chat
- **Deploy workflows run the OLD deploy.sh**: GitHub Actions executes `bash /srv/docker/fitcoach/deploy/deploy.sh <env>` on the VPS before the script pulls the branch — the first deploy after any deploy.sh change runs the previous version. After editing deploy.sh, validate with a manual second run on dev: `ssh filko.dev "cd /srv/docker/fitcoach && ./deploy/deploy.sh dev"`
- Webapp build is part of the server Docker image (`apps/server/Dockerfile`)
- `docker restart` does NOT re-read `env_file` — to apply env changes: `DEPLOY_ENV=dev docker compose -f deploy/docker-compose.yml -p fitcoach-dev up -d <service>` (with DB_* vars exported from .env.dev, like deploy.sh does)

## Local development

- `docker compose up -d db` (root compose, Postgres on :5432, data in `data/local/postgres`). **Run it from the repo root only** — the volume path is relative, so starting it inside a worktree creates a second empty cluster there and the container stays bound to it; check with `docker inspect fitcoach-db --format '{{range .Mounts}}{{.Source}}{{end}}'` (see `docs/DB_SETUP.md` § 2)
- `cd apps/server && npm run dev` → http://localhost:3000 (logs tee'd to `logs/server.log`)
- `cd apps/webapp && npm run dev` → http://localhost:5173/public/webapp/ (vite, base path `/public/webapp/`)
- **Schema changes go through migrations only** (HB-01, 2026-09-11): `npm run drizzle:generate` to create a migration from `schema.ts`, `npm run db:local:migrate` to apply locally; durable envs migrate via `deploy.sh`. `drizzle-kit push` is removed and blocked by CI. The `checkpoints*` tables are LangGraph runtime storage, absent from `schema.ts` — never add them to migrations
- Local bot would use the third Telegram token in `apps/server/.env` (8587616606, separate local bot) — start with `cd apps/bot && npm run serve-bot` if needed; not running by default

## Rules

- Respond in Russian (user preference)
- Docs in this repo are English-only; unique IDs (INV-*, BR-*, S-*, AC-*) — see `docs/DOCUMENTATION_GUIDE.md`

## Spec-Driven Development (Superpowers)

- **Read `docs/STATE.md` first** in any working session — it is the single orientation point (in progress / next / scope). Update it on every status change; never hand-edit its AUTO block (`node scripts/state.mjs --write`).
- Run `node scripts/state.mjs --check` before finishing a task or closing a PR — it fails on close-out debt (merged but plan not `done`) and stale STATE.
- Plan files carry a `- Status: planned | in progress | done` header line; `Status: done` is set as close-out **before** merge (see Status layer in the contract). Task identity = plan slug; hard deps via `- After: <slug>`; PR titles must contain the slug.
- Ideas/findings outside current scope → use the `backlog` skill (classify before writing into `docs/BACKLOG.md`).
- Process methodology: Superpowers plugin (brainstorming → writing-plans → TDD execution → verification/review). Design docs go to `docs/superpowers/specs/`, implementation plans to `docs/superpowers/plans/`.
- Durable specs (ADRs, domain/feature specs, API_SPEC, refactor master plan) stay in `docs/` per the docs-first workflow — they are the law; superpowers artifacts are working documents.
- Every plan task must reference the AC-#### it implements and its verification command. Never silently edit durable specs — escalate to the owner.
- **Plan execution is delegated**: an interactive session orchestrates (planning, review, decisions) and hands implementation to a `claude -p` executor on GLM/z.ai via the `delegate-implementation` skill. Review, `Status:` transitions, merge and deploy are never delegated. Contract: `docs/ORCHESTRATION.md`
- Full contract: `docs/SUPERPOWERS_INTEGRATION.md`
