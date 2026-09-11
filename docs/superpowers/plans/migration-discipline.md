# Migration Discipline (HB-01) Implementation Plan

- Status: planned
- Branch:
- After:

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `drizzle/` migrations the only mechanism that changes the schema in every durable environment, removing `drizzle-kit push` entirely.

**Architecture:** The migration chain is rebuilt from scratch: a squashed `0000_baseline` describing prod's current (older) state, then catch-up migrations bringing prod to `schema.ts`. Live databases receive a stamp into `drizzle.__drizzle_migrations` rather than a replay — dev is stamped through the whole chain (it is already there), prod is stamped at baseline only so the catch-up migrations genuinely run. Migrations execute as a one-shot step in `deploy/deploy.sh` before `up -d`, never at container start.

**Tech Stack:** drizzle-kit (generate/migrate), PostgreSQL 16 + pgvector, Docker Compose, Node 22 (ESM scripts), Jest.

**Spec:** `docs/superpowers/specs/2026-09-11-migration-discipline-design.md`

**Backlog item:** HB-01 (`docs/PLAN-architecture-refactor-backlog.md` § H1). **Blocks:** `LLM_CORE_REFACTOR_PLAN.md` P0.

## Global Constraints

- **Never run `npm run drizzle:push`** at any point in this work (root `CLAUDE.md`); it offers to drop the `checkpoints*` tables.
- **Checkpoint tables are excluded from every schema comparison**: `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations` are created by LangGraph's PostgresSaver and are absent from `schema.ts` (spec F6).
- **Docs in this repo are English-only** (root `CLAUDE.md`).
- **Always `docker compose`, never `docker-compose`**.
- VPS access: `ssh filko.dev`, repo at `/srv/docker/fitcoach`, containers `fitcoach-{dev,prod}-{db,server,bot}`.
- Local commits must be **pushed to origin** before any deploy — `deploy.sh` does `git reset --hard origin/<branch>`.
- `deploy/docker-compose.yml` on the VPS has an uncommitted local change (`mem_limit` on db/server/bot). `deploy.sh`'s `git reset --hard` wipes it. Task 6 commits it so it is not lost.
- Both `.github/workflows/deploy-dev.yml` and `deploy-prod.yml` call `deploy/deploy.sh`, so pushes to `dev`/`main` deploy automatically. Merging to `main` runs the prod migration unattended — Task 9's rehearsal is the gate, not a manual deploy.

---

### Task 1: Establish the true schema delta between dev, prod and `schema.ts`

Spec §2 records a column-level diff only (`information_schema.columns`); indexes, constraints, defaults and FK details were never compared. Everything downstream depends on this being exact, so it comes first and may extend the migration set in Task 3.

**Files:**
- Create: `docs/superpowers/specs/2026-09-11-migration-discipline-design.md` — append a "§2.1 Full dump comparison (measured)" section with the findings
- Create (scratch, not committed): dumps under the session scratchpad

**Interfaces:**
- Consumes: nothing.
- Produces: the confirmed list of objects that differ between prod and `schema.ts`, which Task 3 turns into migrations `0001..N`.

- [ ] **Step 1: Dump both live schemas**

```bash
ssh filko.dev "docker exec fitcoach-dev-db pg_dump -U fitcoach_dev -d fitcoach_dev --schema-only --no-owner --no-privileges" > /tmp/dev.sql
ssh filko.dev "docker exec fitcoach-prod-db pg_dump -U fitcoach_prod -d fitcoach_prod --schema-only --no-owner --no-privileges" > /tmp/prod.sql
```

- [ ] **Step 2: Strip checkpoint objects and compare**

The checkpoint tables are runtime-owned (Global Constraints) and must not appear in the comparison.

```bash
strip() { grep -v 'checkpoint' "$1" | sed '/^--/d; /^$/d'; }
strip /tmp/dev.sql > /tmp/dev.clean.sql
strip /tmp/prod.sql > /tmp/prod.clean.sql
diff /tmp/prod.clean.sql /tmp/dev.clean.sql
```

Expected: differences limited to the spec F3 set — `exercises.id` type, the two referencing FK columns, `exercises.embedding`, `exercises.user_id`, `users.timezone`, and the `idx_exercises_embedding` HNSW index. Anything else is a new finding.

- [ ] **Step 3: Verify dev really equals `schema.ts`**

Bring up a throwaway local database, apply `schema.ts` with drizzle's generator (not push — see Global Constraints), and diff against `/tmp/dev.clean.sql`.

```bash
cd apps/server
docker run -d --name fc-schemacheck -e POSTGRES_PASSWORD=postgres -p 55432:5432 ankane/pgvector
sleep 5
docker exec fc-schemacheck psql -U postgres -c 'CREATE DATABASE probe;'
docker exec fc-schemacheck psql -U postgres -d probe -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

Generate a fresh migration set into a temporary out-dir from the current `schema.ts`, apply it to `probe`, then:

```bash
docker exec fc-schemacheck pg_dump -U postgres -d probe --schema-only --no-owner --no-privileges | grep -v checkpoint | sed '/^--/d; /^$/d' > /tmp/schemats.clean.sql
diff /tmp/schemats.clean.sql /tmp/dev.clean.sql
```

Expected: empty. If not empty, dev has drifted from `schema.ts` too — record it; the baseline plan still holds but Task 3 gains migrations.

- [ ] **Step 4: Record findings in the spec**

Append to the design doc a `### 2.1 Full dump comparison (measured <date>)` section listing, as a table, every object that differs between prod and `schema.ts`, and the result of Step 3. State explicitly whether F3 was complete or extended.

- [ ] **Step 5: Tear down the probe database**

```bash
docker rm -f fc-schemacheck
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-09-11-migration-discipline-design.md
git commit -m "docs: record measured schema delta between prod, dev and schema.ts"
```

---

### Task 2: Baseline migration describing prod's current state

**Files:**
- Delete: `apps/server/drizzle/0000_familiar_stark_industries.sql` … `0007_add-user-timezone.sql`, `apps/server/drizzle/meta/*`
- Create: `apps/server/drizzle/0000_baseline.sql`, `apps/server/drizzle/meta/_journal.json`, `apps/server/drizzle/meta/0000_snapshot.json`
- Create (temporary, deleted in Step 6): `apps/server/src/infra/db/schema.baseline.ts`

**Interfaces:**
- Consumes: Task 1's confirmed delta.
- Produces: `0000_baseline` — the migration Task 4's stamp script marks as applied on both live databases.

The baseline must describe **prod**, which is behind `schema.ts`. Generating it means temporarily describing prod's older shape in a schema file, generating from that, then restoring `schema.ts`.

- [ ] **Step 1: Create the baseline schema file**

Copy `apps/server/src/infra/db/schema.ts` to `schema.baseline.ts` and edit it down to prod's state (spec F3):

- `exercises.id`: `integer('id').primaryKey().generatedByDefaultAsIdentity()` in place of `uuid('id').primaryKey()`
- `exercises`: remove `embedding` and `userId` fields, and remove `embeddingIdx` from the table's index config
- `exerciseMuscleGroups.exerciseId`: `integer('exercise_id')` instead of `uuid(...)`, keeping the same `.references(() => exercises.id, { onDelete: 'cascade' }).notNull()`
- `sessionExercises.exerciseId`: `integer('exercise_id')` instead of `uuid(...)`, keeping its existing reference and notNull
- `users`: remove the `timezone` field

Adjust for anything Task 1 added to the delta.

- [ ] **Step 2: Wipe the stale migration folder**

The existing 8 migrations cannot be reused: `meta` is out of sync with `schema.ts` (spec F2) and no live database references them (F1).

```bash
cd apps/server
rm -f drizzle/*.sql
rm -rf drizzle/meta
```

- [ ] **Step 3: Generate the baseline**

Point drizzle at the baseline schema for one generation only:

```bash
cd apps/server
npx drizzle-kit generate --schema=./src/infra/db/schema.baseline.ts --out=./drizzle --dialect=postgresql --name=baseline
```

Expected: `drizzle/0000_baseline.sql` plus a fresh `meta/` with `_journal.json` and `0000_snapshot.json`.

- [ ] **Step 4: Verify the baseline reproduces prod**

```bash
docker run -d --name fc-baseline -e POSTGRES_PASSWORD=postgres -p 55432:5432 ankane/pgvector
sleep 5
docker exec fc-baseline psql -U postgres -c 'CREATE DATABASE probe;'
docker exec fc-baseline psql -U postgres -d probe -c 'CREATE EXTENSION IF NOT EXISTS vector;'
docker exec -i fc-baseline psql -U postgres -d probe < drizzle/0000_baseline.sql
docker exec fc-baseline pg_dump -U postgres -d probe --schema-only --no-owner --no-privileges | grep -v checkpoint | sed '/^--/d; /^$/d' > /tmp/baseline.clean.sql
diff /tmp/baseline.clean.sql /tmp/prod.clean.sql
```

Expected: empty diff. A non-empty diff means the baseline schema file does not match prod — fix `schema.baseline.ts` and regenerate before continuing.

- [ ] **Step 5: Tear down**

```bash
docker rm -f fc-baseline
```

- [ ] **Step 6: Delete the temporary schema file**

```bash
rm apps/server/src/infra/db/schema.baseline.ts
```

It exists only to generate `0000`; leaving it behind would create a second schema source of truth.

- [ ] **Step 7: Commit**

```bash
git add apps/server/drizzle
git commit -m "feat(db): squash migrations into 0000_baseline describing prod state"
```

---

### Task 3: Catch-up migrations bringing prod to `schema.ts`

**Files:**
- Create: `apps/server/drizzle/0001_*.sql` … (count determined by Task 1)
- Modify: `apps/server/drizzle/meta/_journal.json`, new `meta/000N_snapshot.json` files (written by drizzle-kit)
- Create: `apps/server/src/infra/db/__tests__/migrations.unit.test.ts`

**Interfaces:**
- Consumes: `0000_baseline` from Task 2.
- Produces: a complete chain `0000..N` such that applying all of it to an empty database yields `schema.ts`. Task 4's stamp script stamps dev through `N`, prod through `0` only.

- [ ] **Step 1: Generate the catch-up migrations**

With `schema.baseline.ts` gone, `drizzle.config.ts` points back at the real `schema.ts`, so a plain generate diffs baseline → `schema.ts`:

```bash
cd apps/server
npx drizzle-kit generate --name=adr0012_and_timezone
```

Expected: one migration containing the uuid conversion, the embedding/user_id columns, the HNSW index and `users.timezone`.

- [ ] **Step 2: Replace the generated uuid conversion by hand**

drizzle-kit generates a destructive `DROP COLUMN` / `ADD COLUMN` for an `integer` → `uuid` primary key change, which would discard prod's exercise rows and orphan 53 `session_exercises` and 185 `exercise_muscle_groups` rows (spec F4). Replace that portion of the SQL with a remap that preserves rows:

```sql
--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "id_new" uuid DEFAULT gen_random_uuid() NOT NULL;
--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" ADD COLUMN "exercise_id_new" uuid;
--> statement-breakpoint
ALTER TABLE "session_exercises" ADD COLUMN "exercise_id_new" uuid;
--> statement-breakpoint
UPDATE "exercise_muscle_groups" g SET "exercise_id_new" = e."id_new" FROM "exercises" e WHERE e."id" = g."exercise_id";
--> statement-breakpoint
UPDATE "session_exercises" s SET "exercise_id_new" = e."id_new" FROM "exercises" e WHERE e."id" = s."exercise_id";
--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" DROP CONSTRAINT "exercise_muscle_groups_exercise_id_exercises_id_fk";
--> statement-breakpoint
ALTER TABLE "session_exercises" DROP CONSTRAINT "session_exercises_exercise_id_exercises_id_fk";
--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" DROP CONSTRAINT "exercise_muscle_groups_exercise_id_muscle_group_pk";
--> statement-breakpoint
ALTER TABLE "exercises" DROP CONSTRAINT "exercises_pkey";
--> statement-breakpoint
ALTER TABLE "exercises" DROP COLUMN "id";
--> statement-breakpoint
ALTER TABLE "exercises" RENAME COLUMN "id_new" TO "id";
--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" DROP COLUMN "exercise_id";
--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" RENAME COLUMN "exercise_id_new" TO "exercise_id";
--> statement-breakpoint
ALTER TABLE "session_exercises" DROP COLUMN "exercise_id";
--> statement-breakpoint
ALTER TABLE "session_exercises" RENAME COLUMN "exercise_id_new" TO "exercise_id";
--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" ALTER COLUMN "exercise_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "session_exercises" ALTER COLUMN "exercise_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "exercises" ADD PRIMARY KEY ("id");
--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" ADD PRIMARY KEY ("exercise_id", "muscle_group");
--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" ADD CONSTRAINT "exercise_muscle_groups_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id");
--> statement-breakpoint
DROP SEQUENCE IF EXISTS "exercises_id_seq";
```

Verify `gen_random_uuid()` is available (PostgreSQL 13+ builtin; `pgcrypto` not required on the `ankane/pgvector` image). Keep drizzle's own statements for `exercises.embedding`, `exercises.user_id`, `idx_exercises_embedding` and `users.timezone` as generated.

Note: `exercises.id` in `schema.ts` is `uuid('id').primaryKey()` with **no** default — ids are supplied by the seed. The `DEFAULT gen_random_uuid()` above exists only to populate existing rows during the migration; append a statement dropping it so the final shape matches `schema.ts`:

```sql
--> statement-breakpoint
ALTER TABLE "exercises" ALTER COLUMN "id" DROP DEFAULT;
```

- [ ] **Step 3: Write the failing test for chain completeness**

This test is the machine-checkable form of AC-1 (spec §5). It asserts the migration folder is internally consistent and that the chain is what the stamp script will assume.

```typescript
// apps/server/src/infra/db/__tests__/migrations.unit.test.ts
import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const drizzleDir = path.resolve(__dirname, '../../../../drizzle');

describe('migration folder', () => {
  const journal = JSON.parse(readFileSync(path.join(drizzleDir, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };

  it('starts with the squashed baseline', () => {
    expect(journal.entries[0].tag).toBe('0000_baseline');
  });

  it('has one sql file per journal entry and no orphans', () => {
    const sqlFiles = readdirSync(drizzleDir).filter(f => f.endsWith('.sql')).sort();
    expect(sqlFiles).toEqual(journal.entries.map(e => `${e.tag}.sql`).sort());
  });

  it('numbers entries contiguously from zero', () => {
    expect(journal.entries.map(e => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  it('contains no destructive drop of the exercises table', () => {
    for (const entry of journal.entries) {
      const sql = readFileSync(path.join(drizzleDir, `${entry.tag}.sql`), 'utf8');
      expect(sql).not.toMatch(/DROP TABLE\s+"?exercises"?/i);
    }
  });

  it('exposes a stable sha256 per migration for stamping', () => {
    for (const entry of journal.entries) {
      const sql = readFileSync(path.join(drizzleDir, `${entry.tag}.sql`), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      expect(hash).toHaveLength(64);
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd apps/server && npx jest src/infra/db/__tests__/migrations.unit.test.ts`
Expected before Step 1–2 land: FAIL on the baseline tag or the file/journal match. If it passes immediately, confirm the folder really is in the post-Task-2 state.

- [ ] **Step 5: Verify the full chain reproduces `schema.ts`**

This is AC-1 proper. Apply the whole chain to an empty database and diff against dev.

```bash
cd apps/server
docker run -d --name fc-chain -e POSTGRES_PASSWORD=postgres -p 55432:5432 ankane/pgvector
sleep 5
docker exec fc-chain psql -U postgres -c 'CREATE DATABASE probe;'
docker exec fc-chain psql -U postgres -d probe -c 'CREATE EXTENSION IF NOT EXISTS vector;'
DB_HOST=localhost DB_PORT=55432 DB_USER=postgres DB_PASSWORD=postgres DB_NAME=probe npx drizzle-kit migrate
docker exec fc-chain pg_dump -U postgres -d probe --schema-only --no-owner --no-privileges | grep -v checkpoint | sed '/^--/d; /^$/d' > /tmp/chain.clean.sql
diff /tmp/chain.clean.sql /tmp/dev.clean.sql
docker rm -f fc-chain
```

Expected: empty diff.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/server && npx jest src/infra/db/__tests__/migrations.unit.test.ts`
Expected: PASS, all five cases.

- [ ] **Step 7: Commit**

```bash
git add apps/server/drizzle apps/server/src/infra/db/__tests__/migrations.unit.test.ts
git commit -m "feat(db): add catch-up migrations to schema.ts with non-destructive uuid remap"
```

---

### Task 4: Idempotent baseline stamp script

**Files:**
- Create: `apps/server/src/infra/db/stamp-baseline.ts` (logic — inside `src/` so Jest and ts-jest can reach it)
- Create: `apps/server/scripts/stamp-baseline.ts` (thin CLI wrapper run by tsx)
- Create: `apps/server/src/infra/db/__tests__/stamp-baseline.unit.test.ts`

**Interfaces:**
- Consumes: the migration chain from Tasks 2–3.
- Produces: `hashMigration(sql: string): string` and `migrationsThrough(journal: Journal, tag: string): JournalEntry[]`, plus CLI `npx tsx scripts/stamp-baseline.ts --through <tag>`, invoked by `deploy.sh` (Task 6). Exit 0 = stamped or already present; non-zero = refused.

**Why the split:** `jest.config.cjs` sets `roots: ['<rootDir>/src', '<rootDir>/tests']` and transforms only `.ts`, so a test cannot import a `.mjs` file under `scripts/`. The logic therefore lives in `src/infra/db/stamp-baseline.ts` and `scripts/` holds only the entry point.

- [ ] **Step 1: Write the failing test**

The hash function is the part worth unit-testing: it must match what drizzle itself computes, or the stamp silently lies.

```typescript
// apps/server/src/infra/db/__tests__/stamp-baseline.unit.test.ts
import { createHash } from 'crypto';

import { hashMigration, migrationsThrough, type Journal } from '../stamp-baseline';

describe('stamp-baseline', () => {
  it('hashes migration contents with sha256, matching drizzle', () => {
    const sql = 'CREATE TABLE "x" ("id" uuid);';
    expect(hashMigration(sql)).toBe(createHash('sha256').update(sql).digest('hex'));
  });

  it('selects entries up to and including the requested tag', () => {
    const journal: Journal = {
      entries: [
        { idx: 0, tag: '0000_baseline', when: 1756802083216 },
        { idx: 1, tag: '0001_catchup', when: 1775710481505 },
      ],
    };
    expect(migrationsThrough(journal, '0000_baseline').map(e => e.tag)).toEqual(['0000_baseline']);
    expect(migrationsThrough(journal, '0001_catchup').map(e => e.tag)).toEqual(['0000_baseline', '0001_catchup']);
  });

  it('throws when the requested tag is not in the journal', () => {
    const journal: Journal = { entries: [{ idx: 0, tag: '0000_baseline', when: 1756802083216 }] };
    expect(() => migrationsThrough(journal, '0009_nope')).toThrow(/0009_nope/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && npx jest src/infra/db/__tests__/stamp-baseline.unit.test.ts`
Expected: FAIL — `Cannot find module '../stamp-baseline'`.

- [ ] **Step 3: Write the logic module**

```typescript
// apps/server/src/infra/db/stamp-baseline.ts
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

import pg from 'pg';

export interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

export interface Journal {
  entries: JournalEntry[];
}

export function hashMigration(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function migrationsThrough(journal: Journal, tag: string): JournalEntry[] {
  const idx = journal.entries.findIndex(e => e.tag === tag);
  if (idx === -1) throw new Error(`Migration tag not found in journal: ${tag}`);
  return journal.entries.slice(0, idx + 1);
}

// `drizzleDir` is passed in rather than derived: this is an ESM package
// ("type": "module"), so `__dirname` does not exist at runtime, and the CLI
// wrapper resolves the path from `import.meta.url` instead.
export async function stampBaseline(through: string, drizzleDir: string): Promise<void> {
  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();

  try {
    const existing = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
      ) AS present;
    `);

    if (existing.rows[0].present) {
      const count = await client.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations;');
      if (count.rows[0].n > 0) {
        console.log(`Migration history already present (${count.rows[0].n} rows) — nothing to stamp.`);
        return;
      }
    }

    // Refuse to stamp an empty database: there is nothing to pretend was applied.
    const tables = await client.query(`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name NOT LIKE 'checkpoint%';
    `);
    if (tables.rows[0].n === 0) {
      console.log('Empty database — skipping stamp so migrations apply normally.');
      return;
    }

    const journal = JSON.parse(readFileSync(path.join(drizzleDir, 'meta/_journal.json'), 'utf8')) as Journal;
    const entries = migrationsThrough(journal, through);

    await client.query('BEGIN');
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle;');
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      );
    `);
    for (const entry of entries) {
      const sql = readFileSync(path.join(drizzleDir, `${entry.tag}.sql`), 'utf8');
      await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2);', [
        hashMigration(sql),
        entry.when,
      ]);
    }
    await client.query('COMMIT');
    console.log(`Stamped ${entries.length} migration(s) through ${through}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}
```

Note the two guards: an existing non-empty history is a no-op (so the script stays in `deploy.sh` forever), and an empty database is left alone so a fresh environment migrates normally rather than being falsely stamped.

- [ ] **Step 4: Write the CLI wrapper**

```typescript
// apps/server/scripts/stamp-baseline.ts
import path from 'path';
import { fileURLToPath } from 'url';

import { stampBaseline } from '../src/infra/db/stamp-baseline';

const throughIdx = process.argv.indexOf('--through');
if (throughIdx === -1 || !process.argv[throughIdx + 1]) {
  console.error('Usage: npx tsx scripts/stamp-baseline.ts --through <migration-tag>');
  process.exit(2);
}

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

stampBaseline(process.argv[throughIdx + 1], drizzleDir).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

The server image already runs TypeScript through `tsx` (`apps/server/Dockerfile`), so no build step is needed for this script.

**Note for HB-02:** `tsx` is currently a devDependency. When HB-02 moves the image to `npm ci --omit=dev`, this script loses its runtime — HB-02's plan must either compile it into `dist/` or run the migrate step from a stage that still has dev dependencies. Flag it there; do not pre-solve it here.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/server && npx jest src/infra/db/__tests__/stamp-baseline.unit.test.ts`
Expected: PASS, three cases.

- [ ] **Step 6: Verify the stamp against a real database end to end**

Build a database the way prod was built (baseline schema, no history), stamp it, and confirm `migrate` then applies exactly the catch-up migrations.

```bash
cd apps/server
docker run -d --name fc-stamp -e POSTGRES_PASSWORD=postgres -p 55432:5432 ankane/pgvector
sleep 5
docker exec fc-stamp psql -U postgres -c 'CREATE DATABASE probe;'
docker exec fc-stamp psql -U postgres -d probe -c 'CREATE EXTENSION IF NOT EXISTS vector;'
docker exec -i fc-stamp psql -U postgres -d probe < drizzle/0000_baseline.sql
export DB_HOST=localhost DB_PORT=55432 DB_USER=postgres DB_PASSWORD=postgres DB_NAME=probe
npx tsx scripts/stamp-baseline.ts --through 0000_baseline
npx drizzle-kit migrate
docker exec fc-stamp pg_dump -U postgres -d probe --schema-only --no-owner --no-privileges | grep -v checkpoint | sed '/^--/d; /^$/d' > /tmp/stamped.clean.sql
diff /tmp/stamped.clean.sql /tmp/dev.clean.sql
```

Expected: empty diff — a prod-shaped database reaches `schema.ts` through stamp + migrate.

- [ ] **Step 7: Verify idempotency**

```bash
npx tsx scripts/stamp-baseline.ts --through 0000_baseline
npx drizzle-kit migrate
docker rm -f fc-stamp
```

Expected: the stamp prints "already present — nothing to stamp"; `migrate` reports no pending migrations.

- [ ] **Step 8: Commit**

```bash
git add apps/server/scripts/stamp-baseline.ts apps/server/src/infra/db/stamp-baseline.ts apps/server/src/infra/db/__tests__/stamp-baseline.unit.test.ts
git commit -m "feat(db): add idempotent baseline stamp script"
```

---

### Task 5: Remove every `drizzle-kit push` call site and `ensureSchema`

**Files:**
- Modify: `apps/server/docker-entrypoint.sh` (remove lines 8–20, the expect/push block)
- Modify: `apps/server/Dockerfile:9` (drop `expect` from apt install)
- Modify: `apps/server/package.json` (scripts `db:prod:migrate`, `drizzle:push`, `drizzle:reset`, `db:dev:fresh`)
- Modify: `docker-compose.yml` (root, `migrate` service command)
- Modify: `apps/server/src/infra/db/init.ts` (delete `ensureSchema`)
- Modify: the call site of `ensureSchema` (find with grep in Step 4)
- Modify: `docs/DB_SETUP.md:68,145`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a codebase where migrations are the only schema mechanism; Task 7's CI guard enforces it.

- [ ] **Step 1: Strip the push block from the entrypoint**

Delete the `expect`/`drizzle-kit push --force` block and its two `echo` lines, leaving the pgvector extension step, both seeds and the final `exec`. The entrypoint must no longer alter the schema at all.

- [ ] **Step 2: Drop the now-unused `expect` dependency**

In `apps/server/Dockerfile`, remove `expect` from the apt install list, keeping `postgresql-client` (used by the pgvector step) and `wget` (used by the healthcheck).

- [ ] **Step 3: Repoint the npm scripts**

- `db:prod:migrate`: `NODE_ENV=production drizzle-kit migrate`
- `drizzle:push`: delete the entry entirely
- `drizzle:reset`: `NODE_ENV=test drizzle-kit drop && NODE_ENV=test drizzle-kit migrate`
- `db:dev:fresh`: replace `npm run drizzle:push` with `npm run db:local:migrate`

In root `docker-compose.yml`, change the `migrate` service command to `npx drizzle-kit migrate --config=drizzle.config.ts`.

- [ ] **Step 4: Delete `ensureSchema` and its caller**

```bash
grep -rn "ensureSchema" apps/server/src
```

Delete the function body in `src/infra/db/init.ts` (the whole file if it contains nothing else) and remove the call plus its import from the startup path. The application must not run migrations; that is the deploy step's job (spec D4).

- [ ] **Step 5: Update the developer docs**

In `docs/DB_SETUP.md`, replace the `npm run drizzle:push` instruction at line 68 and the "**Schema push**" bullet at line 145 with the migration workflow: `npm run drizzle:generate` to create a migration from `schema.ts`, `npm run db:local:migrate` to apply it locally, and a note that durable environments apply migrations only through `deploy/deploy.sh`.

- [ ] **Step 6: Verify no call sites remain**

```bash
grep -rn "drizzle-kit push\|drizzle:push" apps/server deploy docker-compose.yml --exclude-dir=node_modules
grep -rn "ensureSchema" apps/server/src
```

Expected: both empty (AC-2, AC-4).

- [ ] **Step 7: Run the quality gates**

Run: `cd apps/server && npm run type-check && npm run lint && npm run test:unit`
Expected: all green (AC-8). Removing `ensureSchema` changes the startup path, so a type error here means a caller was missed.

- [ ] **Step 8: Commit**

```bash
git add apps/server/docker-entrypoint.sh apps/server/Dockerfile apps/server/package.json apps/server/src/infra/db/init.ts docker-compose.yml docs/DB_SETUP.md
git commit -m "refactor(db): remove drizzle-kit push and ensureSchema from all paths"
```

---

### Task 6: Wire stamp + migrate into the deploy script

**Files:**
- Modify: `deploy/docker-compose.yml` (add `migrate` service; also commit the VPS-local `mem_limit` change per Global Constraints)
- Modify: `deploy/deploy.sh` (new steps between build and `up -d`)

**Interfaces:**
- Consumes: `scripts/stamp-baseline.ts` (Task 4) and the migration chain (Tasks 2–3).
- Produces: the deploy path exercised by Tasks 8 and 9.

- [ ] **Step 1: Capture the VPS-local compose change**

Before editing, pull the uncommitted `mem_limit` edit off the VPS so `git reset --hard` does not destroy it:

```bash
ssh filko.dev "cd /srv/docker/fitcoach && git diff deploy/docker-compose.yml"
```

Apply that diff locally and include it in this task's commit.

- [ ] **Step 2: Add the one-shot migrate service**

In `deploy/docker-compose.yml`, add a service that reuses the server image rather than rebuilding:

```yaml
  migrate:
    image: ${MIGRATE_IMAGE}
    container_name: fitcoach-${DEPLOY_ENV}-migrate
    env_file:
      - ../.env.${DEPLOY_ENV}
    environment:
      DB_HOST: db
      DB_PORT: "5432"
    depends_on:
      db:
        condition: service_healthy
    profiles:
      - migrate
    command: ["sh", "-c", "npx tsx scripts/stamp-baseline.ts --through ${STAMP_THROUGH} && npx drizzle-kit migrate"]
```

`MIGRATE_IMAGE` is the image `docker compose build` just produced for `server`; resolve it in `deploy.sh` with `docker compose -f "$COMPOSE_FILE" -p "$PROJECT" images -q server`. `STAMP_THROUGH` differs per environment (Step 3).

- [ ] **Step 3: Insert the deploy steps**

In `deploy/deploy.sh`, between `docker compose ... build` and `docker compose ... up -d`:

```bash
# --- Apply database migrations (before starting new containers) ---
# dev already matches schema.ts, so it is stamped through the whole chain;
# prod is stamped at the baseline only, so the catch-up migrations really run.
if [ "$DEPLOY_ENV" = "prod" ]; then
  STAMP_THROUGH="0000_baseline"
else
  STAMP_THROUGH=$(node -e "const j=require('./apps/server/drizzle/meta/_journal.json');console.log(j.entries[j.entries.length-1].tag)")
fi
export STAMP_THROUGH

MIGRATE_IMAGE=$(docker compose -f "$COMPOSE_FILE" -p "$PROJECT" images -q server)
export MIGRATE_IMAGE

echo "==> Applying migrations (stamp through ${STAMP_THROUGH})"
docker compose -f "$COMPOSE_FILE" -p "$PROJECT" --profile migrate run --rm migrate
```

`set -euo pipefail` is already in force at the top of the script, so a failed migration aborts the deploy before any new container starts (spec D3).

The `STAMP_THROUGH` split matters only on the very first deploy: afterwards both databases have history and the stamp is a no-op. Leave the conditional in place — it is accurate and self-documenting.

- [ ] **Step 4: Verify the script parses and the ordering is right**

```bash
bash -n deploy/deploy.sh
grep -n "migrate\|up -d\|Backing up" deploy/deploy.sh
```

Expected: no syntax errors; the order reads backup → build → migrate → `up -d`.

- [ ] **Step 5: Commit**

```bash
git add deploy/deploy.sh deploy/docker-compose.yml
git commit -m "feat(deploy): run baseline stamp and migrations before starting containers"
```

---

### Task 7: CI guard against `push` returning

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the clean state produced by Task 5.
- Produces: AC-3 — a PR reintroducing `push` fails CI.

- [ ] **Step 1: Add the guard step**

In `.github/workflows/ci.yml`, inside the `check-server` job, add a step before the existing lint/type-check steps. Note `check-server` sets `working-directory: apps/server`, so this step overrides it to scan the repository root:

```yaml
      - name: Guard against drizzle-kit push
        working-directory: .
        run: |
          if grep -rn "drizzle-kit push\|drizzle:push" apps/server deploy docker-compose.yml --exclude-dir=node_modules; then
            echo "::error::drizzle-kit push is forbidden (HB-01) — use migrations"
            exit 1
          fi
          echo "OK: no drizzle-kit push call sites"
```

- [ ] **Step 2: Verify the guard passes on the current tree**

```bash
grep -rn "drizzle-kit push\|drizzle:push" apps/server deploy docker-compose.yml --exclude-dir=node_modules; echo "exit=$?"
```

Expected: no matches, `exit=1` from grep — which the `if` treats as success.

- [ ] **Step 3: Verify the guard actually catches a violation**

```bash
echo '# drizzle-kit push' >> docker-compose.yml
grep -rn "drizzle-kit push\|drizzle:push" apps/server deploy docker-compose.yml --exclude-dir=node_modules
git checkout docker-compose.yml
```

Expected: the match is found (so the step would fail), then the file is restored.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: fail builds that reintroduce drizzle-kit push"
```

---

### Task 8: Deploy to dev and verify

**Files:** none changed — this task verifies Tasks 2–7 against the live dev environment.

**Interfaces:**
- Consumes: everything above, pushed to `origin/dev`.
- Produces: the green dev result that gates Task 9.

- [ ] **Step 1: Record pre-deploy row counts**

```bash
ssh filko.dev "docker exec fitcoach-dev-db psql -U fitcoach_dev -d fitcoach_dev -c \"select 'users' t, count(*) from users union all select 'conversation_turns', count(*) from conversation_turns union all select 'session_sets', count(*) from session_sets union all select 'exercises', count(*) from exercises;\""
```

Save the output — AC-5 compares against it.

- [ ] **Step 2: Push and let the deploy run**

```bash
git push origin dev
```

`.github/workflows/deploy-dev.yml` runs CI then `deploy.sh dev`. Watch it:

```bash
gh run watch
```

Expected: CI green (including the new guard), deploy ends with `==> Deploy dev OK`.

- [ ] **Step 3: Verify migration history exists and is complete**

```bash
ssh filko.dev "docker exec fitcoach-dev-db psql -U fitcoach_dev -d fitcoach_dev -c 'select id, hash, created_at from drizzle.__drizzle_migrations order by id;'"
```

Expected: one row per migration in the chain (AC-5).

- [ ] **Step 4: Verify no data was lost**

Re-run Step 1's query and compare. Expected: identical counts (AC-5).

- [ ] **Step 5: Verify the service is healthy**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://fitcoach-dev.filko.dev/health
ssh filko.dev "docker logs fitcoach-dev-server --tail 30"
```

Expected: `200`; logs show a clean start with no schema activity (the entrypoint no longer pushes).

- [ ] **Step 6: Round-trip a real message**

Send one message to `@MyFitAiCoachDevBot` and confirm a reply. Then:

```bash
ssh filko.dev "docker logs fitcoach-dev-server --tail 30 | grep -E 'POST /api/(user|chat)'"
```

Expected: the POST lines appear (AC-5). Per root `CLAUDE.md`, the bot logs only errors — verify through the server logs, not the bot's.

- [ ] **Step 7: Verify the deploy is idempotent**

```bash
ssh filko.dev "cd /srv/docker/fitcoach && ./deploy/deploy.sh dev"
```

Expected (AC-6): the stamp reports history already present; `drizzle-kit migrate` applies nothing; health check green; row counts still unchanged.

---

### Task 9: Rehearse the prod migration on a restored backup, then ship to prod

The uuid remap is the only genuinely risky step in this plan, and merging to `main` runs it unattended (Global Constraints). The rehearsal is the gate.

**Files:** none changed.

**Interfaces:**
- Consumes: a green Task 8.
- Produces: prod on `schema.ts`, AC-7 satisfied.

- [ ] **Step 1: Take a fresh prod backup**

```bash
npm run db:backup:prod
```

Expected: a dump under `backups/prod/`. This is also the rollback artifact (spec §4.6).

- [ ] **Step 2: Restore it into a throwaway database**

```bash
docker run -d --name fc-rehearsal -e POSTGRES_PASSWORD=postgres -p 55432:5432 ankane/pgvector
sleep 5
docker exec fc-rehearsal psql -U postgres -c 'CREATE DATABASE rehearsal;'
docker exec fc-rehearsal psql -U postgres -d rehearsal -c 'CREATE EXTENSION IF NOT EXISTS vector;'
docker exec -i fc-rehearsal psql -U postgres -d rehearsal < backups/prod/<latest>.sql
```

- [ ] **Step 3: Record the row counts that must survive**

```bash
docker exec fc-rehearsal psql -U postgres -d rehearsal -c "select 'exercises' t, count(*) from exercises union all select 'exercise_muscle_groups', count(*) from exercise_muscle_groups union all select 'session_exercises', count(*) from session_exercises union all select 'session_sets', count(*) from session_sets union all select 'users', count(*) from users;"
```

Expected (spec F4): exercises 59, exercise_muscle_groups 185, session_exercises 53, session_sets 188, users 2.

- [ ] **Step 4: Run the real deploy path against the rehearsal database**

```bash
cd apps/server
export DB_HOST=localhost DB_PORT=55432 DB_USER=postgres DB_PASSWORD=postgres DB_NAME=rehearsal
npx tsx scripts/stamp-baseline.ts --through 0000_baseline
npx drizzle-kit migrate
```

Expected: the stamp writes one row; `migrate` applies every catch-up migration without error.

- [ ] **Step 5: Assert nothing was lost and the FKs still hold**

```bash
docker exec fc-rehearsal psql -U postgres -d rehearsal -c "select 'exercises' t, count(*) from exercises union all select 'exercise_muscle_groups', count(*) from exercise_muscle_groups union all select 'session_exercises', count(*) from session_exercises union all select 'session_sets', count(*) from session_sets union all select 'users', count(*) from users;"
docker exec fc-rehearsal psql -U postgres -d rehearsal -c "select count(*) as orphaned_muscle_groups from exercise_muscle_groups g left join exercises e on e.id = g.exercise_id where e.id is null;"
docker exec fc-rehearsal psql -U postgres -d rehearsal -c "select count(*) as orphaned_session_exercises from session_exercises s left join exercises e on e.id = s.exercise_id where e.id is null;"
docker exec fc-rehearsal psql -U postgres -d rehearsal -c "select pg_typeof(id) from exercises limit 1;"
```

Expected: counts identical to Step 3; both orphan counts `0`; `pg_typeof` reports `uuid`. A non-zero orphan count means the remap in Task 3 Step 2 is wrong — stop and fix it there.

- [ ] **Step 6: Confirm the rehearsal database now matches `schema.ts`**

```bash
docker exec fc-rehearsal pg_dump -U postgres -d rehearsal --schema-only --no-owner --no-privileges | grep -v checkpoint | sed '/^--/d; /^$/d' > /tmp/rehearsal.clean.sql
diff /tmp/rehearsal.clean.sql /tmp/dev.clean.sql
docker rm -f fc-rehearsal
```

Expected: empty diff.

- [ ] **Step 7: Merge to main**

Only with Steps 4–6 green and Task 8 fully green. Open the PR from `dev` to `main` (title must contain the plan slug `migration-discipline`), and merge. `deploy-prod.yml` then runs `deploy.sh prod`, which backs up, stamps through `0000_baseline` and applies the catch-up migrations.

```bash
gh run watch
```

Expected: `==> Deploy prod OK`.

- [ ] **Step 8: Verify prod (AC-7)**

```bash
ssh filko.dev "docker exec fitcoach-prod-db psql -U fitcoach_prod -d fitcoach_prod -c \"select 'exercises' t, count(*) from exercises union all select 'exercise_muscle_groups', count(*) from exercise_muscle_groups union all select 'session_exercises', count(*) from session_exercises;\""
ssh filko.dev "docker exec fitcoach-prod-db psql -U fitcoach_prod -d fitcoach_prod -At -F'|' -c \"select table_name,column_name,data_type from information_schema.columns where table_schema='public' and table_name not like 'checkpoint%' order by table_name,column_name;\"" > /tmp/prod.after.txt
ssh filko.dev "docker exec fitcoach-dev-db psql -U fitcoach_dev -d fitcoach_dev -At -F'|' -c \"select table_name,column_name,data_type from information_schema.columns where table_schema='public' and table_name not like 'checkpoint%' order by table_name,column_name;\"" > /tmp/dev.after.txt
diff /tmp/prod.after.txt /tmp/dev.after.txt && echo "prod now matches dev"
curl -s -o /dev/null -w '%{http_code}\n' https://fitcoach.filko.dev/health
```

Expected: exercises 59, exercise_muscle_groups 185, session_exercises 53; the column diff is empty; health `200`.

- [ ] **Step 9: Round-trip a message through the prod bot**

Send one message to the prod bot and confirm a reply, then check the server logs for `POST /api/user` and `POST /api/chat`. Expected: both present, no errors.

---

### Task 10: Close out

**Files:**
- Modify: `docs/superpowers/plans/migration-discipline.md` (this file)
- Modify: `docs/STATE.md` (AUTO block, via script)
- Modify: `docs/PLAN-architecture-refactor-backlog.md` (HB-01 disposition)

Per `SUPERPOWERS_INTEGRATION.md` § Status layer, close-out happens **before** the merge that completes the work; since Task 9 merges to `main`, run this immediately before Task 9 Step 7 and push it as part of the same PR.

- [ ] **Step 1: Tick every checkbox in this plan and set the status**

Set the header to `- Status: done` and fill `- Branch:` with the branch used.

- [ ] **Step 2: Regenerate STATE.md**

```bash
node scripts/state.mjs --write
```

- [ ] **Step 3: Update the hand-written STATE.md sections**

Under "Next (dispatch order)", remove the HB-01 entry (item 1) and promote Refactor P0 to first, noting its precondition is now met.

- [ ] **Step 4: Mark HB-01 done in the backlog**

In `docs/PLAN-architecture-refactor-backlog.md` § H1, note HB-01 as shipped with the plan slug, leaving HB-02 open.

- [ ] **Step 5: Run the close-out gate**

Run: `node scripts/state.mjs --check`
Expected: passes with no close-out debt and no stale STATE.

- [ ] **Step 6: Verify P0's precondition check from the master plan**

`LLM_CORE_REFACTOR_PLAN.md` P0 specifies: `grep -rn "drizzle-kit push" apps/server/docker-entrypoint.sh deploy/` → empty.

Run it. Expected: empty — P0 is unblocked.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/migration-discipline.md docs/STATE.md docs/PLAN-architecture-refactor-backlog.md
git commit -m "docs: close out migration-discipline plan, unblock refactor P0"
```
