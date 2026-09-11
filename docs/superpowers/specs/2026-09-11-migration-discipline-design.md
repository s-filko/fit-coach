# Design — Migration discipline (HB-01)

Replace `drizzle-kit push` with real `drizzle/` migrations in every durable environment.

- Backlog item: **HB-01** (`docs/PLAN-architecture-refactor-backlog.md` § H1)
- Blocks: `LLM_CORE_REFACTOR_PLAN.md` **P0** (adds `conversation_runs` + columns; these
  must ship as migrations only)
- Out of scope here: **HB-02** (production Docker image) — separate design and plan,
  sequenced after this one via `- After:`.

## 1. Problem

Three competing mechanisms decide the live schema today:

| Mechanism | Location | Effect |
|---|---|---|
| `drizzle-kit push --force` | `apps/server/docker-entrypoint.sh:13` | Runs on **every** container start, prod included; derives schema from `schema.ts` and can apply destructive changes silently |
| `ensureSchema()` | `apps/server/src/infra/db/init.ts:5-27` | Shells out to `drizzle-kit migrate`, but only when `user_accounts` is absent |
| `drizzle/` folder | `apps/server/drizzle/` | 8 migrations, never applied at runtime |

`push` wins in practice. The migration folder is decorative.

## 2. Findings from the live environments (2026-09-11)

These facts were measured, not assumed; they drive the design.

**F1 — No migration history anywhere.** `drizzle.__drizzle_migrations` does not exist on
either dev or prod. Both databases were built entirely by `push`. A naive `drizzle-kit
migrate` would try to apply `0000` from scratch and fail on existing objects.

**F2 — `drizzle/meta` is out of sync with `schema.ts`.** `0007_add-user-timezone.sql` is
hand-written; `meta/0007_snapshot.json` does not contain `users.timezone`. A naive
`generate` would therefore emit a duplicate `ADD COLUMN timezone`.

**F3 — dev and prod have diverged.** dev matches `schema.ts`; prod does not:

| Difference | dev / `schema.ts` | prod |
|---|---|---|
| `exercises.id` | `uuid` | `integer` (`nextval` sequence) |
| `exercise_muscle_groups.exercise_id` | `uuid` | `integer` |
| `session_exercises.exercise_id` | `uuid` | `integer` |
| `exercises.embedding` (`vector(384)`, ADR-0012) | present | absent |
| `exercises.user_id` | present | absent |
| `users.timezone` | present | absent |

Prod is missing ADR-0012 (semantic search) and the timezone column. The `integer` → `uuid`
change on `exercises.id` is a table rebuild with two dependent foreign keys, over live
user data — not an `ALTER COLUMN`.

**F4 — prod data volumes are small**, so a data migration is tractable in a single
transaction: users 2, exercises 59, exercise_muscle_groups 185, session_exercises 53,
session_sets 188, workout_sessions 10, conversation_turns 234.

**F5 — enums match** between dev and prod (all 7 enum types, identical labels and order).

**F6 — checkpoint tables are runtime-owned.** `checkpoints`, `checkpoint_blobs`,
`checkpoint_writes`, `checkpoint_migrations` are created by LangGraph's PostgresSaver, are
absent from `schema.ts`, and must be excluded from every schema comparison.

**Verification gap (must close as task 1):** F3 comes from comparing
`information_schema.columns` only — names, types, nullability. Indexes, constraints,
defaults and FK details were not diffed. A full `pg_dump --schema-only` comparison is the
first task of the plan, and may extend the catch-up migration below.

## 3. Decisions

**D1 — Baseline describes prod, not `schema.ts`.** The squashed `0000_baseline`
reproduces the *older shared* state (prod's). dev's extra objects (ADR-0012, timezone)
become migrations `0001+` on top of it. This is the only ordering where a single linear
migration chain is true for both environments.

**D2 — Live databases are stamped, not migrated, at the baseline point.** A script
creates `drizzle.__drizzle_migrations` and inserts the rows for migrations already
reflected in that database:

- **prod**: baseline only → the catch-up migrations then really run and bring prod to
  `schema.ts`.
- **dev**: baseline *and* the catch-up migrations → nothing runs; dev is already there.

The script is idempotent: a database that already has migration rows is left untouched.

**D3 — Migrations run as a deploy step, never at container start.** A one-shot `migrate`
service (compose profile `migrate`, same image as `server`) runs between the existing
backup and `up -d` in `deploy/deploy.sh`. Under `set -euo pipefail` a failed migration
aborts the deploy: old containers keep serving the old schema, new ones never start.

**D4 — The application no longer touches the schema.** `ensureSchema()` is deleted.
Migrations are a deploy concern exclusively.

**D5 — `push` is removed from all four sites and kept out by CI.** A grep check in CI
fails any PR that reintroduces it; without that, the discipline decays.

## 4. Design

### 4.1 Migration chain

```
0000_baseline          state as of prod today (integer exercise ids, no embedding,
                       no user_id, no timezone)
0001_adr0012_uuid      exercises.id integer → uuid, with FK rebuild in
                       exercise_muscle_groups and session_exercises
0002_adr0012_vectors   exercises.embedding vector(384), exercises.user_id,
                       HNSW index idx_exercises_embedding
0003_user_timezone     users.timezone
```

Exact split of 0001–0003 is confirmed by the task-1 dump comparison; the shape above is
the expectation, not a promise.

`0001` is the only risky migration. It runs inside one transaction: add `id_uuid` columns,
populate with generated UUIDs, remap the two referencing tables by join on the old
integer id, drop old columns and the sequence, rename, re-establish primary and foreign
keys. `session_exercises` rows carry real user training history and must all survive —
row counts before and after are asserted.

### 4.2 Stamping script

`apps/server/scripts/stamp-baseline.mjs`:

1. If `drizzle.__drizzle_migrations` exists and has rows → exit 0, no output beyond a note.
2. Otherwise create the table (matching drizzle's own DDL) and insert one row per
   migration named in `--through <tag>`, using the sha256 of each migration file's
   contents, the hash drizzle itself computes.
3. Which migrations to stamp is passed explicitly by the caller, so the decision is
   visible in `deploy.sh` rather than inferred.

### 4.3 Deploy flow

```
git reset --hard  →  backup  →  build  →  stamp baseline  →  migrate  →  up -d  →  health
```

Both new steps are idempotent, so they stay in the script permanently; on every
subsequent deploy the stamp is a no-op and `migrate` applies only genuinely new files.

### 4.4 Removing `push`

| Site | Now | After |
|---|---|---|
| `apps/server/docker-entrypoint.sh` | `expect` + `drizzle-kit push --force` | block deleted; `expect` also dropped from `apps/server/Dockerfile` |
| `package.json` `db:prod:migrate` | `drizzle-kit push` | `drizzle-kit migrate` |
| `package.json` `drizzle:push`, `drizzle:reset`, `db:dev:fresh` | push against dev | `drizzle:push` deleted; the other two use `migrate` |
| root `docker-compose.yml` service `migrate` | `drizzle-kit push` | `drizzle-kit migrate` |

Seeds (`exercises.seed.ts`, `seed-embeddings.ts`) stay in the entrypoint unchanged: they
are idempotent and are not schema management.

### 4.5 Deployment is automated — the rehearsal is the safety gate

`.github/workflows/deploy-dev.yml` and `deploy-prod.yml` run `deploy/deploy.sh` over SSH
on every push to `dev` / `main`. Both therefore pick up the new steps automatically, but
it also means **merging to `main` runs `0001` against prod unattended**.

Decision: CI/CD is left alone. Instead, `0001` is rehearsed on a database restored from
the prod backup (task in the plan, before the merge to `main`), with row-count and FK
assertions. The merge is a normal merge only once that rehearsal is green and dev has
completed both a first and a second (idempotent) deploy.

### 4.6 Rollback

Reverting the PR restores the previous entrypoint. Live data is untouched by the baseline
step itself (a stamp only). The one irreversible artifact is
`drizzle.__drizzle_migrations`, which does not interfere with the old `push` path.

`0001` is the exception: once prod's exercise ids are UUIDs, rolling back means restoring
the pre-deploy backup that `deploy.sh` already takes. This is why prod's deploy is a
deliberate, observed step, not a routine one.

## 5. Acceptance criteria

Each is a command or an observation, per HB-01's AC ("no code path calls `drizzle-kit
push` outside local scratch DBs; fresh deploy and upgrade both apply only `drizzle/`
migrations").

1. **Baseline is faithful.** An empty database migrated with the full chain produces a
   `pg_dump --schema-only` identical to dev's, excluding the four checkpoint tables (F6).
2. **`push` is gone.** `grep -rn "drizzle-kit push\|drizzle:push" apps/server deploy
   docker-compose.yml --exclude-dir=node_modules` → empty.
3. **CI guards it.** The same grep runs in CI and fails a PR that reintroduces `push`.
4. **`ensureSchema` is gone.** `grep -rn "ensureSchema" apps/server/src` → empty.
5. **dev survives the switch.** After deploy: `drizzle.__drizzle_migrations` holds one row
   per migration in the chain; `users`, `conversation_turns`, `session_sets` row counts
   are unchanged from before the deploy; `/health` returns 200; one manual bot message
   round-trips.
6. **Deploy is idempotent.** A second `./deploy/deploy.sh dev` applies no migrations,
   changes no rows, and still ends green.
7. **prod catches up.** After deploy, prod's column set equals dev's (the F3 table is
   resolved); `exercises` = 59 rows, `session_exercises` = 53 rows, `exercise_muscle_groups`
   = 185 rows, all FKs valid; `/health` 200; one manual bot message round-trips.
8. **Quality gates.** `npm run type-check && npm run lint && npm run test:unit` green.

## 6. Risks

| Risk | Mitigation |
|---|---|
| `0001` corrupts prod training history | Small volumes (F4), single transaction, row-count assertions, rehearsed on a restored copy of the prod backup **before** the real run |
| Task-1 dump diff reveals more drift than F3 | Catch-up migrations extend; the design shape holds |
| Stamp marks a migration a database has not actually got | AC-1 proves the chain reproduces dev; prod is stamped at baseline only, so every catch-up migration genuinely runs |
| Prod deploy is the first real exercise of the new path | dev goes first and must be fully green, including the idempotent second deploy |
| Merge to `main` triggers the prod migration unattended (§4.5) | Mandatory rehearsal of `0001` on a restored prod backup before the merge; merge only after dev is green twice |

## 7. Durable-doc impact

No durable spec changes: HB-01 already states the target, and no invariant, endpoint or
business rule changes. `docs/DB_SETUP.md` is updated with the migration workflow as part
of the implementation (it documents the developer-facing commands being replaced).
