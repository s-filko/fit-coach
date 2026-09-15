# Refactor P0 — Transcript Export Implementation Plan

- Status: planned
- Branch: plan/refactor-p0-transcript-export
- After: refactor-p0-eval-baseline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export real conversation runs and turns as redacted JSONL, so eval datasets are curated from what users actually said instead of what we imagine they say.

**Architecture:** One script, `evals:export`, reading `conversation_runs` joined to `conversation_turns` since a given date and emitting one JSON object per run. Redaction is applied on the way out, not on the way in: names are pseudonymised deterministically (the same user is the same pseudonym across the export, so multi-turn structure survives), and every field the `LOGGING_GUIDE` forbids is dropped. The output is a *draft* case per run — phase, fixture skeleton, input text, the tools actually called — which a human then edits into a real case with an `expect` block. The script never writes into `evals/datasets/`; it writes to a directory the human curates from.

**Tech Stack:** Drizzle ORM queries, tsx, Node `crypto` (HMAC for stable pseudonyms), JSONL.

**Spec:** `docs/LLM_CORE_REFACTOR_PLAN.md` § P0 scope item 6. Redaction rules: `docs/LOGGING_GUIDE.md` § "Forbidden data categories". Dataset provenance: `docs/PROMPT_EVAL_FRAMEWORK.md` §3, BR-EVAL-003.

**Acceptance criteria:** none of AC-1301..AC-1304 directly — this is the last P0 scope item, and its own gate is Task 4's verification against real dev data.

## Global Constraints

- **BR-EVAL-003: fixtures contain no real user data.** The export's whole purpose is turning real data into data that is no longer personal. If a field cannot be safely pseudonymised, drop it rather than transform it.
- **Never write exported material into `evals/datasets/` automatically.** A case enters a dataset only after a human reviews it. The script writes to `evals/exports/`, which is gitignored.
- **Never print raw message text to stdout.** The script writes files; its console output is counts and paths only. A terminal scrollback is not a safe place for user health data.
- **Read-only against the database.** The script issues `SELECT`s and nothing else.
- **`conversation_turns.run_id` is NULL for every row written before the run-log migration** — the export must handle rows with no run association rather than silently dropping the entire history that predates P0.
- Verification commands run from `apps/server/`.
- Commit messages carry no attribution lines.

---

### Task 1: Implement deterministic redaction

Redaction is the part that must be right; it gets its own module and its own tests before anything touches the database.

**Files:**
- Create: `apps/server/evals/lib/redact.ts`
- Create: `apps/server/evals/lib/__tests__/redact.unit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```typescript
export function pseudonymise(userId: string): string;      // stable per userId, e.g. 'user-4f2a1c'
export function redactText(text: string, firstName: string | null): string;
export interface RedactedUser { languageCode: string; timezone: string; age?: number; gender?: string; height?: string; weight?: string; fitnessLevel?: string; fitnessGoal?: string }
export function redactUser(user: Record<string, unknown>): RedactedUser;
```

Task 3's exporter calls all three.

- [ ] **Step 1: Write the failing redaction test**

Create `apps/server/evals/lib/__tests__/redact.unit.test.ts`:

```typescript
import { pseudonymise, redactText, redactUser } from '../redact';

describe('pseudonymise', () => {
  it('is stable for the same user id', () => {
    expect(pseudonymise('abc')).toBe(pseudonymise('abc'));
  });

  it('differs between users', () => {
    expect(pseudonymise('abc')).not.toBe(pseudonymise('xyz'));
  });

  it('never contains the original id', () => {
    expect(pseudonymise('11111111-1111-4111-8111-111111111111')).not.toContain('11111111');
  });
});

describe('redactText', () => {
  it('replaces the user first name wherever it appears', () => {
    expect(redactText('Привет, Сергей! Как дела, Сергей?', 'Сергей')).toBe('Привет, [NAME]! Как дела, [NAME]?');
  });

  it('is case-insensitive about the name', () => {
    expect(redactText('привет сергей', 'Сергей')).toBe('привет [NAME]');
  });

  it('removes email addresses', () => {
    expect(redactText('пиши на a.b@example.com', null)).toBe('пиши на [EMAIL]');
  });

  it('removes phone-like number runs', () => {
    expect(redactText('мой номер +49 170 1234567', null)).toContain('[PHONE]');
  });

  it('keeps training numbers intact', () => {
    expect(redactText('жим 80 на 8', null)).toBe('жим 80 на 8');
  });

  it('handles a null name without throwing', () => {
    expect(redactText('привет', null)).toBe('привет');
  });
});

describe('redactUser', () => {
  it('keeps only the fields a fixture needs', () => {
    const result = redactUser({
      id: 'u1',
      firstName: 'Сергей',
      lastName: 'Петров',
      username: 'sergey',
      languageCode: 'ru',
      timezone: 'Europe/Berlin',
      age: 34,
      weight: '84.5',
    });
    expect(result).toEqual({ languageCode: 'ru', timezone: 'Europe/Berlin', age: 34, weight: '84.5' });
    expect(Object.keys(result)).not.toContain('firstName');
    expect(Object.keys(result)).not.toContain('username');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- redact`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement redaction**

Create `apps/server/evals/lib/redact.ts`:

```typescript
import { createHash } from 'node:crypto';

/**
 * Redaction for exported transcripts — BR-EVAL-003 and LOGGING_GUIDE
 * "Forbidden data categories". Pseudonyms are stable within and across exports
 * so multi-turn structure survives, and irreversible without the original id.
 */
export function pseudonymise(userId: string): string {
  return `user-${createHash('sha256').update(userId).digest('hex').slice(0, 6)}`;
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const PHONE = /\+?\d[\d\s()-]{8,}\d/g;

export function redactText(text: string, firstName: string | null): string {
  let out = text.replace(EMAIL, '[EMAIL]').replace(PHONE, '[PHONE]');
  if (firstName && firstName.length >= 2) {
    const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), '[NAME]');
  }
  return out;
}

export interface RedactedUser {
  languageCode: string;
  timezone: string;
  age?: number;
  gender?: string;
  height?: string;
  weight?: string;
  fitnessLevel?: string;
  fitnessGoal?: string;
}

/** Allowlist, not a denylist: a new PII column must not leak by default. */
const FIXTURE_FIELDS = [
  'languageCode',
  'timezone',
  'age',
  'gender',
  'height',
  'weight',
  'fitnessLevel',
  'fitnessGoal',
] as const;

export function redactUser(user: Record<string, unknown>): RedactedUser {
  const out: Record<string, unknown> = {};
  for (const field of FIXTURE_FIELDS) {
    if (user[field] !== undefined && user[field] !== null) {
      out[field] = user[field];
    }
  }
  return out as unknown as RedactedUser;
}
```

The allowlist is the important choice: when a later phase adds a column to `users`, it is excluded until someone deliberately adds it here.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test:unit -- redact`
Expected: PASS, all ten cases. If the phone pattern also eats `жим 80 на 8`, tighten it until both that case and the phone case pass — training numbers surviving is not optional, they are the content.

- [ ] **Step 5: Commit**

```bash
git add evals/lib/redact.ts evals/lib/__tests__/redact.unit.test.ts
git commit -m "feat(evals): add deterministic redaction for exported transcripts"
```

---

### Task 2: Implement the export query

Reading the two tables into run-shaped records, handling the pre-P0 rows that carry no `run_id`.

**Files:**
- Create: `apps/server/evals/lib/export-query.ts`
- Create: `apps/server/evals/lib/__tests__/export-query.unit.test.ts`

**Interfaces:**
- Consumes: `conversationRuns`, `conversationTurns` (run-log plan Task 1).
- Produces:

```typescript
export interface ExportedRun {
  runId: string | null;
  userId: string;
  phase: string;
  createdAt: Date;
  model: string | null;
  turns: Array<{ role: string; kind: string; content: string; createdAt: Date }>;
}
export async function fetchRunsSince(since: Date, limit: number): Promise<ExportedRun[]>;
```

Task 3 turns these into draft cases.

- [ ] **Step 1: Write the failing query test**

The test mocks Drizzle so it stays offline. Create `apps/server/evals/lib/__tests__/export-query.unit.test.ts`:

```typescript
const runRows = [
  {
    runId: 'r1',
    userId: 'u1',
    phaseIn: 'chat',
    model: 'z-ai/glm-5.3',
    createdAt: new Date('2026-09-01T10:00:00Z'),
  },
];
const turnRows = [
  { userId: 'u1', runId: 'r1', role: 'user', kind: 'human', content: 'привет', createdAt: new Date('2026-09-01T10:00:00Z') },
  { userId: 'u1', runId: 'r1', role: 'assistant', kind: 'ai', content: 'здравствуй', createdAt: new Date('2026-09-01T10:00:05Z') },
];

jest.mock('@infra/db/drizzle', () => ({
  db: {
    select: () => ({
      from: (table: { _: { name: string } }) => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => (String(table).includes('runs') ? runRows : turnRows),
          }),
        }),
      }),
    }),
  },
}));

import { fetchRunsSince } from '../export-query';

describe('fetchRunsSince', () => {
  it('groups turns under their run', async () => {
    const runs = await fetchRunsSince(new Date('2026-08-01'), 100);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.turns).toHaveLength(2);
    expect(runs[0]?.phase).toBe('chat');
  });
});
```

If mocking Drizzle's builder chain proves brittle, replace this unit test with a `RUN_DB_TESTS=1` integration test that seeds two turns and one run against the local database — the grouping logic is what must be covered, by whichever route is less fragile.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- export-query`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the query**

Create `apps/server/evals/lib/export-query.ts`:

```typescript
import { and, asc, gte, isNotNull } from 'drizzle-orm';

export interface ExportedRun {
  runId: string | null;
  userId: string;
  phase: string;
  createdAt: Date;
  model: string | null;
  turns: Array<{ role: string; kind: string; content: string; createdAt: Date }>;
}

export async function fetchRunsSince(since: Date, limit: number): Promise<ExportedRun[]> {
  const { db } = await import('@infra/db/drizzle');
  const { conversationRuns, conversationTurns } = await import('@infra/db/schema');

  const runs = await db
    .select({
      runId: conversationRuns.runId,
      userId: conversationRuns.userId,
      phaseIn: conversationRuns.phaseIn,
      model: conversationRuns.model,
      createdAt: conversationRuns.createdAt,
    })
    .from(conversationRuns)
    .where(gte(conversationRuns.createdAt, since))
    .orderBy(asc(conversationRuns.createdAt))
    .limit(limit);

  const turns = await db
    .select({
      userId: conversationTurns.userId,
      runId: conversationTurns.runId,
      role: conversationTurns.role,
      kind: conversationTurns.kind,
      content: conversationTurns.content,
      createdAt: conversationTurns.createdAt,
    })
    .from(conversationTurns)
    .where(and(gte(conversationTurns.createdAt, since), isNotNull(conversationTurns.runId)))
    .orderBy(asc(conversationTurns.createdAt))
    .limit(limit * 4);

  const byRun = new Map<string, ExportedRun['turns']>();
  for (const turn of turns) {
    if (!turn.runId) {
      continue;
    }
    const bucket = byRun.get(turn.runId) ?? [];
    bucket.push({ role: turn.role, kind: turn.kind, content: turn.content, createdAt: turn.createdAt });
    byRun.set(turn.runId, bucket);
  }

  return runs.map(run => ({
    runId: run.runId,
    userId: run.userId,
    phase: run.phaseIn,
    createdAt: run.createdAt,
    model: run.model,
    turns: byRun.get(run.runId) ?? [],
  }));
}
```

Turns written before the run-log migration have `run_id = NULL` and are excluded by the `isNotNull` filter. That is deliberate: a turn with no run has no phase-in/model context and cannot become a faithful case. Task 4 reports how many such rows were skipped so the loss is visible rather than silent.

> **Post-execution correction (2026-09-15, orchestrator ruling):** the paragraph above is superseded by measured dev data — all 742 turns on dev (runs 2026-09-12..09-14) carry `run_id = NULL`, because production `appendTurn` never threads `runId` at all (filed separately as BUG-016; fixing `src/` is out of scope here). A `run_id`-only join can never match real data, so `fetchRunsSince` gained a fallback join: for runs with no `run_id`-linked turns, select the user's turns with `created_at` inside the run's own time window — `[run.createdAt − run.latencyMs, run.createdAt]`, no invented precision. Explicit `run_id` links take precedence when present. Both paths are unit-tested in `export-query.unit.test.ts`.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test:unit -- export-query`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add evals/lib/export-query.ts evals/lib/__tests__/export-query.unit.test.ts
git commit -m "feat(evals): query conversation runs and their turns for export"
```

---

### Task 3: Write the export script

The CLI that joins the two previous tasks and emits draft cases.

**Files:**
- Create: `apps/server/evals/export.ts`
- Create: `apps/server/evals/exports/.gitignore`
- Modify: `apps/server/package.json` (add `evals:export`)

**Interfaces:**
- Consumes: `fetchRunsSince`, `pseudonymise`, `redactText`, `redactUser`.
- Produces: `evals/exports/<date>.jsonl`, one draft case per run.

- [ ] **Step 1: Add the gitignore first**

Create `apps/server/evals/exports/.gitignore`:

```gitignore
*
!.gitignore
```

Exported material is redacted but still derived from real users; it stays out of git regardless.

- [ ] **Step 2: Write the script**

Create `apps/server/evals/export.ts`:

```typescript
/**
 * Export redacted production runs as draft eval cases.
 * Usage: npm run evals:export -- --since 2026-09-01 [--limit 200]
 *
 * Output is a DRAFT: each record has no `expect` block. A human adds the
 * expectations and moves the case into evals/datasets/ (BR-EVAL-003, §3).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fetchRunsSince } from './lib/export-query';
import { pseudonymise, redactText, redactUser } from './lib/redact';

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const sinceArg = argValue('--since', '');
  if (!sinceArg) {
    console.error('Usage: npm run evals:export -- --since YYYY-MM-DD [--limit 200]');
    process.exit(2);
  }
  const since = new Date(sinceArg);
  if (Number.isNaN(since.getTime())) {
    console.error(`Not a date: ${sinceArg}`);
    process.exit(2);
  }
  const limit = Number(argValue('--limit', '200'));

  const runs = await fetchRunsSince(since, limit);

  const { db } = await import('@infra/db/drizzle');
  const { users } = await import('@infra/db/schema');
  const userRows = await db.select().from(users);
  const usersById = new Map(userRows.map(u => [u.id, u as unknown as Record<string, unknown>]));

  const lines: string[] = [];
  let skippedEmpty = 0;

  for (const run of runs) {
    if (run.turns.length === 0) {
      skippedEmpty += 1;
      continue;
    }
    const user = usersById.get(run.userId) ?? {};
    const firstName = (user['firstName'] as string | null) ?? null;

    const humanTurns = run.turns.filter(t => t.kind === 'human');
    const input = humanTurns[humanTurns.length - 1];
    if (!input) {
      skippedEmpty += 1;
      continue;
    }

    lines.push(
      JSON.stringify({
        id: `DRAFT-${run.runId?.slice(0, 8) ?? 'unknown'}`,
        phase: run.phase,
        tags: ['exported', 'needs-review'],
        fixture: { user: redactUser(user) },
        state: {
          phase: run.phase,
          messages: run.turns
            .slice(0, -1)
            .map(t => ({ role: t.kind === 'human' ? 'human' : 'ai', text: redactText(t.content, firstName) })),
        },
        input: { text: redactText(input.content, firstName) },
        expect: {},
        provenance: {
          runId: run.runId ?? undefined,
          addedBy: pseudonymise(run.userId),
          date: run.createdAt.toISOString().slice(0, 10),
        },
      }),
    );
  }

  const outDir = join(import.meta.dirname, 'exports');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');

  // Counts and paths only — never message content (LOGGING_GUIDE).
  console.log(`Exported ${lines.length} draft cases to ${outPath} (${skippedEmpty} runs skipped: no usable turns)`);
}

void main();
```

Note `state.messages` maps every non-human turn to `ai` — P0's `kind` column does not yet distinguish tool calls from assistant text in `conversation_turns`. That is a known approximation; P3's richer turn kinds improve it.

- [ ] **Step 3: Add the npm script**

In `apps/server/package.json`:

```json
    "evals:export": "tsx --env-file=.env evals/export.ts",
```

- [ ] **Step 4: Check the argument handling without a database**

Run: `npm run evals:export`
Expected: the usage line and exit 2 — it must fail on a missing `--since` before it ever opens a connection.

Run: `npm run evals:export -- --since not-a-date`
Expected: `Not a date: not-a-date` and exit 2.

- [ ] **Step 5: Commit**

```bash
git add evals/export.ts evals/exports/.gitignore package.json
git commit -m "feat(evals): export redacted production runs as draft eval cases"
```

---

### Task 4: Verify the export against real dev data

Redaction that has only ever been tested against invented strings is not yet trustworthy. This runs it on real material and inspects the output by eye.

**Files:**
- Modify: this plan file (record the counts under Step 4)

**Interfaces:**
- Consumes: the deployed run log on dev (`refactor-p0-run-log` Task 6).
- Produces: the evidence that the export is safe to use.

- [ ] **Step 1: Confirm dev has run rows to export**

Run: `ssh filko.dev "docker exec fitcoach-dev-db psql -U fitcoach_dev -d fitcoach_dev -c 'SELECT count(*) FROM conversation_runs;'"`
Expected: a non-zero count. If it is zero, send a few messages to `@MyFitAiCoachDevBot` first — there is nothing to verify against otherwise.

- [ ] **Step 2: Export from dev**

The script runs locally against the dev database. Either point `.env`'s `DB_*` at dev for one run, or run it on the VPS inside the server container — whichever matches how other one-off scripts are run in this repo. Then:

Run: `npm run evals:export -- --since 2026-09-01 --limit 50`
Expected: the summary line with a non-zero count and a path.

- [ ] **Step 3: Inspect the output for leaks — the actual gate**

Open the produced file and read it. Check every one of these:
- no first names, surnames or usernames anywhere,
- no email addresses or phone numbers,
- no raw user UUIDs (`provenance.addedBy` must be a `user-xxxxxx` pseudonym),
- training content (weights, reps, exercise names, complaints) **intact** — an export that redacted the content is useless,
- each record's `input.text` is the last human turn, and `state.messages` holds what came before it.

Run: `grep -ciE "[[:alpha:]]+@[[:alpha:]]+\.|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}" evals/exports/*.jsonl`
Expected: `0`. Any hit is a redaction defect — fix `redact.ts`, add the missing case to its unit test, and re-export.

- [ ] **Step 4: Record the counts**

Write into this plan under this task: how many runs were exported, how many were skipped, and the result of the Step 3 grep.

- [ ] **Step 5: Curate one real case end to end**

Take one draft record, add an `expect` block to it by hand, move it into the appropriate dataset with a proper id and `"deprecated": false`, and validate:

Run: `npx tsx -e "import {parseCases} from './evals/schema/case.schema'; import {readFileSync} from 'node:fs'; console.log(parseCases(readFileSync('./evals/datasets/<phase>/<file>.jsonl','utf8')).length, 'cases OK');"`
Expected: the count including the new case.

**Do not** regenerate the `v0` baseline to include it. A baseline is frozen; a case added after it simply has no baseline entry, and `compareToBaseline` reports it under `added`. That is the designed behaviour.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/refactor-p0-transcript-export.md evals/datasets/
git commit -m "docs(evals): verify transcript export against dev data and curate the first real case"
```

---

### Task 5: Close P0

Every P0 scope item now has a merged plan. This task confirms that as a fact rather than an impression.

**Files:**
- Modify: `docs/STATE.md` (the hand-written "Next" section — the AUTO block is regenerated, never hand-edited)

**Interfaces:**
- Consumes: the five preceding P0 plans.
- Produces: an orientation point that says P1 is next.

- [ ] **Step 1: Confirm every P0 acceptance criterion has evidence**

Walk `docs/LLM_CORE_REFACTOR_PLAN.md` § P0 and check each:
- AC-1301 — the integration test in `tests/integration/api/chat-run-log.integration.test.ts` passes.
- AC-1302 — `grep -rn "PromptService\|training-intent.types\|plan-creation.types" src` is empty and the three checks pass.
- AC-1303 — `npm run evals -- --level L0` passes offline; `evals/baselines/v0/*.json` exists for five phases.
- AC-1304 — the dev run rows recorded in `refactor-p0-run-log` Task 6.

Any criterion without evidence means P0 is not done — say so and stop, rather than closing it.

- [ ] **Step 2: Re-read the P0 rollback condition**

The master plan's P0 rollback trigger is run-row writes adding over 100 ms p95 to `/api/bot/chat`, or any 5xx. Check current dev behaviour:

Run: `ssh filko.dev "docker logs fitcoach-dev-server --tail 300 | grep -c 'Failed to record conversation run'"`
Expected: `0`. A non-zero count means the run log is failing silently in production and P0 has a defect to fix before it closes.

- [ ] **Step 3: Update the hand-written part of STATE.md**

In `docs/STATE.md` § "Next (dispatch order)", replace the P0 entry with P1 as the head of the queue, and note in § Scope that P0 is complete with the baseline at `evals/baselines/v0/`. Do not touch the AUTO block.

- [ ] **Step 4: Regenerate and check**

Run (from the repo root): `node scripts/state.mjs --write && node scripts/state.mjs --check`
Expected: the AUTO block lists all six P0 plans as done; `--check` passes with no close-out debt.

- [ ] **Step 5: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): close refactor P0 and queue P1"
```

---

## Close-out

Follow `superpowers:finishing-a-development-branch`. Before merge: run the `close-out-review` skill, tick every checkbox above, set `- Status: done`, run `node scripts/state.mjs --write` from the repo root, and commit. `node scripts/state.mjs --check` must pass.
