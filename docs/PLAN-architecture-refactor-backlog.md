# PLAN — Hygiene & Ops Backlog (complement to the LLM Core Refactor Plan)

Source: two independent architecture reviews (2026-09-10), merged.
**Relationship to the master plan**: everything LLM-core (graph, state, memory, prompts,
errors, legacy path, evals, concurrency, doctrine) is governed by
`docs/adr/0013-llm-core-target-architecture.md` + `docs/LLM_CORE_REFACTOR_PLAN.md`
(phases P0–P7) + `docs/PROMPT_EVAL_FRAMEWORK.md`. This file keeps ONLY the items those
documents do not cover — infrastructure, ops, repo hygiene, bot-client, and the mini-app
epic — plus the review-merge map. Do not duplicate master-plan scope here.

**Mini-app (`apps/webapp`, `/api/app/*`) remains frozen** — see E-05 and ADR-0013 §9.

## Merge map (original review IDs → disposition)

| Original item | Disposition |
|---|---|
| AR-02 zod on legacy JSON path | Superseded by P1 (gateway `withStructuredOutput` + one retry). Interim fix optional only if P1 slips. |
| AR-03 checkpoint message accumulation | **Premise wrong, corrected.** Subgraphs compile without checkpointer; parent state has no `messages` channel — history is rebuilt from `conversation_turns` per turn; tool calls/results are lost after the turn. Superseded by D-01/D-02, phase P4. |
| AR-04 bot polling watchdog | Covered by P5.3 (BUG-012). |
| AR-05 dual LLM stack / dead prompt layer | Covered by P0.4 (delete) + P1 (LlmGateway). |
| AR-06 error taxonomy | Covered by D-08 + P5.2. |
| AR-07 TrainingService split | Partially covered by P1.3 (LLM deps removed, methods deleted). The class split is deferred: re-evaluate after P1 shrinks it; split only if it is still a hub for graph tools. |
| AR-12 extractNode/dedup copy-paste | Covered by P3.3 (PhaseSpec factory + shared tool executor). |
| AR-13 deleteThread vs raw SQL | Covered by P4.4. |
| E-01 prompt evals | Covered by `PROMPT_EVAL_FRAMEWORK.md` + P0/P7. |
| E-02 token observability | Covered by D-11 (`conversation_runs`). |
| E-03 context strategy | Covered by D-03 + P4.3. |
| E-04 graph node testability | Largely covered by P3 (factory/deps injection); model injection stays explicit if tests need it. |

Items below are **not** in the master plan and stay here.

---

## H1 — DB migration discipline (top priority, do before master-plan P0)

### HB-01 — Replace `drizzle-kit push` with real migrations in all environments
- Evidence: `apps/server/docker-entrypoint.sh:13` (`drizzle-kit push --force` on every
  container start, including prod); `src/infra/db/init.ts:5-27` (`ensureSchema` runs
  `migrate` only when DB is empty); `drizzle/` folder exists but is never used at runtime.
- Problem: push derives schema from `schema.ts` and can silently apply destructive changes
  to live data. Two competing sources of truth. The master plan adds new tables/columns
  (P0) — migrations must be the only mechanism by then.
- Fix: `drizzle-kit generate` + `migrate` as an explicit step in `deploy/deploy.sh` before
  `up -d`; remove push from the entrypoint; delete push-based npm scripts for durable envs.
- AC: no code path calls `drizzle-kit push` outside local scratch DBs; fresh deploy and
  upgrade both apply only `drizzle/` migrations.

### HB-02 — Production Docker image
- Server image runs from source via tsx with all devDependencies
  (`apps/server/Dockerfile:11`, `docker-entrypoint.sh:35`); the `build` script (tsup) is
  dead. Fix: multi-stage build → `npm ci --omit=dev` + `node dist/index.js`.
- Bot container gets the entire `.env` via `env_file` (`deploy/docker-compose.yml`) —
  pass only required vars via `environment:`.

## H2 — Server/bot hygiene

### HB-03 — Timeouts
- Model client: no `timeout`/`maxRetries` (`infra/ai/model.factory.ts:112-129`) — OpenAI
  SDK default waits up to 10 min. Add `timeout: 60_000, maxRetries: 2` when touching
  `getModel` (or as part of P1 model profiles).
- Bot HTTP: axios without timeout (`apps/bot/handlers.ts:26-31`) — add `timeout: 30_000`
  (pairs with P5.3 hardening).

### HB-04 — Auth must not depend on plugin registration order
- Evidence: `app-security`/`bot-security` use `fp()` with global `preHandler`
  (`src/app/server.ts:26-31`); a route plugin registered before the security plugin
  compiles, lints, and serves unprotected.
- Fix: scope routes as children of an encapsulated (non-`fp`) security plugin, or add a
  startup assertion that all non-public routes are covered.
- AC: reordering plugins in `server.ts` does not change auth coverage; a test asserts
  every route is public or protected.

### HB-05 — Typed bot API client
- Evidence: bot parses responses by hand (`apps/bot/handlers.ts:100,140`); twin dead
  packages `packages/shared/`, `apps/shared/` (both `@fit-coach/shared`, zero imports).
- Fix: delete both packages; export route DTO types (zod-inferred) from the server or a
  single shared location; bot consumes them. Do not design for the webapp (E-05).
- AC: `ChatResponseDto` and bot-consumed types defined exactly once.

### HB-06 — Small correctness fixes
- `conversation_turns` user/assistant pair inserted with identical `created_at`
  (`drizzle-conversation-context.service.ts:25-28`) → non-deterministic ordering; add a
  monotonic tie-breaker (must survive P0/P4 schema changes — coordinate).
- Config: cache `loadConfig()` (re-parsed per request in middlewares);
  `z.coerce.number()` for ports; remove the hidden `Number(DB_PORT || 5432)` default.

### HB-07 — Dead code & repo drift (not covered by P7 doctrine work)
- `src/shared/__tests__/date-utils.unit.test.ts` — stale duplicate of
  `tests/unit/shared/date-utils.unit.test.ts`.
- `git rm --cached apps/server/scripts/migrate-to-uuid.ts` (committed despite
  `.gitignore:56-57`; rule does not affect tracked files).
- Root-level strays `ADR-0008-IMPLEMENTATION-SUMMARY.md`, `GRAFANA_SETUP.md` → `docs/`;
  README broken `[Architecture](ARCHITECTURE.md)` link and stale ADR count; loose
  `docs/PLAN-*.md` / `IMPLEMENTATION_PLAN.md` / `CHAT_PHASE_JSON_FIX.md` / `MVP_*.md` →
  archive or fold.
- `apps/webapp/vite.config.ts:32` hardcoded tailnet host → env var (only if webapp is
  touched at all before E-05).
- Schema comment drift: `schema.ts:48-50` MVP statuses vs default `registration`.

## Epics

### E-05 — Mini-app redesign (deferred; explicitly out of scope)
Rethink the mini-app's product role against the post-refactor architecture, then integrate
per ADR-0013 §9 constraints (one core path, rendering profile, writes via tools/domain +
`system_note`, reads as read models). Includes typed DTOs derived from server schemas,
mutation error/loading/retry states, UI cleanups (duplicated `spawnRipple`, per-page state
template, `PlanningView` retry). Nothing here blocks or is blocked by the master plan.

## Suggested execution order

1. **HB-01 + HB-02** (ops PR) — before master-plan P0, since P0 adds DB schema.
2. **Master plan P0–P7** per its own ordering.
3. **HB-03..HB-07** batched alongside (HB-03 with P1/P5 where noted; HB-06 tie-breaker
   coordinated with P0 schema work).
4. **E-05** after the target architecture is in place.
