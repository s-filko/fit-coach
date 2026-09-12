# Refactor P0 — Eval Harness (L0) Implementation Plan

- Status: planned
- Branch: plan/refactor-p0-eval-harness
- After: refactor-p0-run-log

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the eval runner, the case schema and the offline L0 checks, so prompts can be inspected mechanically on every PR without spending a token.

**Architecture:** A standalone `apps/server/evals/` tree, run by `tsx` rather than Jest — evals are a measurement tool with reports and baselines, not a pass/fail unit suite, and later levels need sampling and cost control Jest does not model. The runner is level-agnostic from the start (`--level L0|L1`), but only L0 is implemented here: render each phase's current system prompt against three fixtures and assert section presence, token budget and forbidden strings. L1's wiring is the next plan; this one defines the shapes it will fill.

**Tech Stack:** TypeScript + tsx (ESM), Zod (case schema), Node's `node:test`-free custom reporter (plain console + JSON), the existing prompt builders in `src/infra/ai/graph/nodes/*.node.ts`.

**Spec:** `docs/PROMPT_EVAL_FRAMEWORK.md` §2 (layers), §3 (case schema), §4.1 (L0 checks). Master plan: `docs/LLM_CORE_REFACTOR_PLAN.md` § P0 scope item 5, first half.

**Acceptance criteria:** the L0 half of AC-1303 — `npm run evals -- --level L0` passes offline.

## Global Constraints

- **L0 must never call a model and never touch the database.** It runs in CI on every PR; a network call there is a defect.
- **Fixtures contain no real user data** (BR-EVAL-003). Hand-written personas only in this plan; the export script (`refactor-p0-transcript-export`) is what brings redacted production material in later.
- **A case is immutable once a baseline references it** (BR-EVAL-001). No baselines exist yet, so cases written here are still free to change — after the baseline plan lands, they are not.
- **Token estimation is chars/4 with a 1.15 safety factor** for Cyrillic-heavy text (master plan P2 item 3 fixes this formula; L0 adopts it now so the two never disagree). One implementation, unit-tested.
- **No prompt wording changes.** If a prompt fails an L0 check, report it — do not "fix" the prompt in this plan. It is a P2 concern and possibly a real finding.
- Verification commands run from `apps/server/`.
- Commit messages carry no attribution lines.

---

### Task 1: Create the evals tree, the token estimator and the runner skeleton

The runner comes first so every later check has a home. It must be reachable from `npm run evals` and included in type-checking.

**Files:**
- Create: `apps/server/evals/run.ts` (CLI entry)
- Create: `apps/server/evals/lib/token-estimator.ts`
- Create: `apps/server/evals/lib/reporter.ts`
- Create: `apps/server/evals/lib/__tests__/token-estimator.unit.test.ts`
- Modify: `apps/server/package.json` (add the `evals` script)
- Modify: `apps/server/tsconfig.json:22` (add `evals/**/*` to `include`)
- Modify: `apps/server/jest.config.cjs` (add `<rootDir>/evals` to `roots` so the estimator's unit test runs)

**Interfaces:**
- Consumes: nothing.
- Produces:

```typescript
// evals/lib/token-estimator.ts
export function estimateTokens(text: string): number;

// evals/lib/reporter.ts
export interface CheckResult { case: string; check: string; passed: boolean; detail?: string }
export interface LevelReport { level: string; total: number; passed: number; failed: number; results: CheckResult[] }
export function printReport(report: LevelReport): void;
export function exitCodeFor(report: LevelReport): number;
```

Tasks 2 and 3 produce `CheckResult[]`; the L1 plan reuses all three modules unchanged.

- [x] **Step 1: Write the failing token-estimator test**

Create `apps/server/evals/lib/__tests__/token-estimator.unit.test.ts`:

```typescript
import { estimateTokens } from '../token-estimator';

describe('estimateTokens', () => {
  it('is chars/4 with a 1.15 safety factor, rounded up', () => {
    // 40 chars → 10 * 1.15 = 11.5 → 12
    expect(estimateTokens('a'.repeat(40))).toBe(12);
  });

  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates Cyrillic text at least as high as Latin of the same length', () => {
    const latin = estimateTokens('a'.repeat(100));
    const cyrillic = estimateTokens('я'.repeat(100));
    expect(cyrillic).toBeGreaterThanOrEqual(latin);
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- token-estimator`
Expected: FAIL — module not found (and, until Step 6, the file may not even be collected; that also counts as a failing state).

- [x] **Step 3: Implement the estimator**

Create `apps/server/evals/lib/token-estimator.ts`:

```typescript
/**
 * Single token estimator for the whole eval stack and (from P2) the context
 * assembler: characters / 4, times a 1.15 safety factor that covers
 * Cyrillic-heavy text tokenising worse than Latin.
 * Master plan P2 item 3 fixes this formula — keep the two in step.
 */
const CHARS_PER_TOKEN = 4;
const SAFETY_FACTOR = 1.15;

export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil((text.length / CHARS_PER_TOKEN) * SAFETY_FACTOR);
}
```

- [x] **Step 4: Write the reporter**

Create `apps/server/evals/lib/reporter.ts`:

```typescript
export interface CheckResult {
  case: string;
  check: string;
  passed: boolean;
  detail?: string;
}

export interface LevelReport {
  level: string;
  total: number;
  passed: number;
  failed: number;
  results: CheckResult[];
}

export function buildReport(level: string, results: CheckResult[]): LevelReport {
  const passed = results.filter(r => r.passed).length;
  return { level, total: results.length, passed, failed: results.length - passed, results };
}

export function printReport(report: LevelReport): void {
  for (const result of report.results) {
    if (!result.passed) {
      console.error(`FAIL  ${result.case} :: ${result.check}${result.detail ? ` — ${result.detail}` : ''}`);
    }
  }
  console.log(`\n${report.level}: ${report.passed}/${report.total} checks passed, ${report.failed} failed`);
}

export function exitCodeFor(report: LevelReport): number {
  return report.failed > 0 ? 1 : 0;
}
```

- [x] **Step 5: Write the runner skeleton**

Create `apps/server/evals/run.ts`:

```typescript
/**
 * Eval runner — see docs/PROMPT_EVAL_FRAMEWORK.md.
 * Usage: npm run evals -- --level L0 [--phase chat|all]
 */
import { runL0 } from './levels/l0';
import { buildReport, exitCodeFor, printReport } from './lib/reporter';

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const level = argValue('--level', 'L0').toUpperCase();
  const phase = argValue('--phase', 'all');

  if (level !== 'L0') {
    console.error(`Level ${level} is not implemented yet (P0 ships L0; L1 follows).`);
    process.exit(2);
  }

  const results = await runL0(phase);
  const report = buildReport(level, results);
  printReport(report);
  process.exit(exitCodeFor(report));
}

void main();
```

This imports `./levels/l0`, which Task 3 creates — the runner will not execute until then. That is expected: Step 7 only checks that the estimator's test passes.

- [x] **Step 6: Add the script and widen tsconfig/jest**

In `apps/server/package.json`, add to `scripts`:

```json
    "evals": "tsx --env-file=.env evals/run.ts",
```

In `apps/server/tsconfig.json`, change the `include` line to:

```json
  "include": ["src/**/*", "tests/**/*", "evals/**/*", "drizzle.config.ts"],
```

In `apps/server/jest.config.cjs`, change `roots` to:

```javascript
  roots: ['<rootDir>/src', '<rootDir>/tests', '<rootDir>/evals'],
```

- [x] **Step 7: Run the estimator test to confirm it passes**

Run: `npm run test:unit -- token-estimator`
Expected: PASS, all three cases.

- [x] **Step 8: Commit**

```bash
git add evals/ package.json tsconfig.json jest.config.cjs
git commit -m "feat(evals): add eval runner skeleton, token estimator and reporter"
```

---

### Task 2: Define the case schema and the fixture types

The case schema is the contract every dataset obeys and every later level reads. It is written now, in full, even though only its `fixture` half is exercised by L0 — the dataset plan must not have to invent it.

**Files:**
- Create: `apps/server/evals/schema/case.schema.ts`
- Create: `apps/server/evals/schema/__tests__/case.schema.unit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `EvalCaseSchema` (Zod) and `export type EvalCase = z.infer<typeof EvalCaseSchema>`, plus `parseCases(jsonl: string): EvalCase[]`. The dataset plan writes `.jsonl` files that this parses; the L1 plan reads `case.expect`.

- [x] **Step 1: Write the failing schema test**

Create `apps/server/evals/schema/__tests__/case.schema.unit.test.ts`:

```typescript
import { EvalCaseSchema, parseCases } from '../case.schema';

const minimalCase = {
  id: 'CH-0001',
  phase: 'chat',
  tags: ['transition'],
  fixture: { user: { languageCode: 'ru', timezone: 'Europe/Berlin' } },
  input: { text: 'давай потренируемся' },
  expect: { tools: { must: ['request_transition'] } },
};

describe('EvalCaseSchema', () => {
  it('accepts a minimal case', () => {
    expect(() => EvalCaseSchema.parse(minimalCase)).not.toThrow();
  });

  it('rejects an unknown phase', () => {
    expect(() => EvalCaseSchema.parse({ ...minimalCase, phase: 'cooking' })).toThrow();
  });

  it('rejects a case with no id', () => {
    const { id: _id, ...noId } = minimalCase;
    expect(() => EvalCaseSchema.parse(noId)).toThrow();
  });

  it('defaults deprecated to false', () => {
    expect(EvalCaseSchema.parse(minimalCase).deprecated).toBe(false);
  });

  it('parses JSONL, skipping blank lines', () => {
    const jsonl = `${JSON.stringify(minimalCase)}\n\n${JSON.stringify({ ...minimalCase, id: 'CH-0002' })}\n`;
    const cases = parseCases(jsonl);
    expect(cases.map(c => c.id)).toEqual(['CH-0001', 'CH-0002']);
  });

  it('reports the offending line number on a malformed case', () => {
    const jsonl = `${JSON.stringify(minimalCase)}\n{"id":"broken"}\n`;
    expect(() => parseCases(jsonl)).toThrow(/line 2/);
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- case.schema`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the schema**

Create `apps/server/evals/schema/case.schema.ts`:

```typescript
import { z } from 'zod';

/** Case schema — docs/PROMPT_EVAL_FRAMEWORK.md §3. */
export const EvalPhaseSchema = z.enum(['registration', 'chat', 'plan_creation', 'session_planning', 'training']);

const FixtureUserSchema = z.object({
  languageCode: z.string(),
  timezone: z.string(),
  firstName: z.string().optional(),
  age: z.number().optional(),
  gender: z.string().optional(),
  height: z.string().optional(),
  weight: z.string().optional(),
  fitnessLevel: z.string().optional(),
  fitnessGoal: z.string().optional(),
  registrationCompleted: z.boolean().optional(),
});

const FixtureSchema = z.object({
  user: FixtureUserSchema,
  hasActivePlan: z.boolean().optional(),
  plan: z.unknown().optional(),
  sessions: z.array(z.unknown()).optional(),
  activeSession: z.unknown().optional(),
  facts: z.array(z.unknown()).optional(),
});

const StateMessageSchema = z.object({
  role: z.enum(['human', 'ai', 'tool_call', 'tool_result']),
  text: z.string(),
});

const ExpectSchema = z.object({
  tools: z
    .object({
      must: z.array(z.string()).optional(),
      mustNot: z.array(z.string()).optional(),
      args: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  transition: EvalPhaseSchema.nullable().optional(),
  text: z
    .object({
      mustMatch: z.array(z.string()).optional(),
      mustNotMatch: z.array(z.string()).optional(),
      language: z.string().optional(),
      format: z.literal('telegram_html').optional(),
      maxChars: z.number().optional(),
    })
    .optional(),
  judge: z.array(z.string()).optional(),
});

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  phase: EvalPhaseSchema,
  tags: z.array(z.string()).default([]),
  deprecated: z.boolean().default(false),
  fixture: FixtureSchema,
  state: z
    .object({
      phase: EvalPhaseSchema.optional(),
      activeSessionId: z.string().nullable().optional(),
      messages: z.array(StateMessageSchema).default([]),
    })
    .optional(),
  input: z.object({ text: z.string().min(1) }),
  expect: ExpectSchema,
  provenance: z
    .object({
      runId: z.string().optional(),
      addedBy: z.string().optional(),
      date: z.string().optional(),
    })
    .optional(),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalFixture = z.infer<typeof FixtureSchema>;

export function parseCases(jsonl: string): EvalCase[] {
  const cases: EvalCase[] = [];
  const lines = jsonl.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
    if (!line) {
      continue;
    }
    try {
      cases.push(EvalCaseSchema.parse(JSON.parse(line)));
    } catch (err) {
      throw new Error(`Invalid eval case at line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return cases;
}
```

- [x] **Step 4: Run the test to confirm it passes**

Run: `npm run test:unit -- case.schema`
Expected: PASS, all six cases.

- [x] **Step 5: Commit**

```bash
git add evals/schema/
git commit -m "feat(evals): define the eval case schema and JSONL parser"
```

---

### Task 3: Implement the L0 static checks

L0 renders each phase's real system prompt against three fixtures and inspects the result. It must call the production prompt builders, not copies — the point is to check what actually ships.

**Files:**
- Create: `apps/server/evals/fixtures/personas.ts`
- Create: `apps/server/evals/levels/l0.ts`
- Create: `apps/server/evals/levels/__tests__/l0.unit.test.ts`

**Interfaces:**
- Consumes: `estimateTokens` and `CheckResult` (Task 1); the production prompt builders in `src/infra/ai/graph/nodes/*.node.ts`.
- Produces: `export async function runL0(phase: string): Promise<CheckResult[]>` — the function `evals/run.ts` already imports.

- [x] **Step 1: Inventory the real prompt builders**

Run: `grep -rn "^export function build.*Prompt\|^export function build.*SystemPrompt" src/infra/ai/graph/nodes/*.ts`
Expected: one exported builder per phase. Note each exact name and its parameter list — Step 4 calls them with real arguments, and guessing a signature here produces a plan-shaped failure rather than a check.

- [x] **Step 2: Write the three fixture personas**

Create `apps/server/evals/fixtures/personas.ts`:

```typescript
import type { EvalFixture } from '../schema/case.schema';

/** Three fixtures every L0 check renders against — §4.1: empty, complete, active session. */
export const EMPTY_PROFILE: EvalFixture = {
  user: { languageCode: 'ru', timezone: 'Europe/Berlin', firstName: 'Тест', registrationCompleted: false },
  hasActivePlan: false,
};

export const COMPLETE_PROFILE: EvalFixture = {
  user: {
    languageCode: 'ru',
    timezone: 'Europe/Berlin',
    firstName: 'Тест',
    age: 34,
    gender: 'male',
    height: '182',
    weight: '84.5',
    fitnessLevel: 'intermediate',
    fitnessGoal: 'strength',
    registrationCompleted: true,
  },
  hasActivePlan: true,
};

export const ACTIVE_SESSION: EvalFixture = {
  ...COMPLETE_PROFILE,
  activeSession: { id: 'session-1', sessionKey: 'Upper A' },
};

export const ALL_FIXTURES: Array<{ name: string; fixture: EvalFixture }> = [
  { name: 'empty-profile', fixture: EMPTY_PROFILE },
  { name: 'complete-profile', fixture: COMPLETE_PROFILE },
  { name: 'active-session', fixture: ACTIVE_SESSION },
];
```

- [x] **Step 3: Write the failing L0 test**

Create `apps/server/evals/levels/__tests__/l0.unit.test.ts`:

```typescript
import { FORBIDDEN_STRINGS, checkRenderedPrompt } from '../l0';

describe('L0 static checks', () => {
  it('flags a prompt containing "undefined"', () => {
    const results = checkRenderedPrompt('chat', 'empty-profile', 'Your age is undefined years.');
    const forbidden = results.find(r => r.check === 'no-forbidden-strings');
    expect(forbidden?.passed).toBe(false);
    expect(forbidden?.detail).toContain('undefined');
  });

  it('passes a clean prompt', () => {
    const results = checkRenderedPrompt('chat', 'empty-profile', 'You are a fitness coach. Be concise.');
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('flags an empty prompt as non-renderable', () => {
    const results = checkRenderedPrompt('chat', 'empty-profile', '   ');
    const nonEmpty = results.find(r => r.check === 'renders-non-empty');
    expect(nonEmpty?.passed).toBe(false);
  });

  it('flags a prompt over the token budget', () => {
    const results = checkRenderedPrompt('chat', 'empty-profile', 'x'.repeat(200_000));
    const budget = results.find(r => r.check === 'within-token-budget');
    expect(budget?.passed).toBe(false);
  });

  it('lists every forbidden string the spec names', () => {
    expect(FORBIDDEN_STRINGS).toEqual(expect.arrayContaining(['undefined', 'null', '[object Object]', 'NaN']));
  });
});
```

- [x] **Step 4: Run it to confirm it fails**

Run: `npm run test:unit -- l0`
Expected: FAIL — module `../l0` not found.

- [x] **Step 5: Implement L0**

Create `apps/server/evals/levels/l0.ts`. Replace the `renderPrompt` switch arms with the **actual** builder names and signatures found in Step 1 — the names below are the shape, not a guess to be shipped unchecked:

```typescript
import type { CheckResult } from '../lib/reporter';
import { estimateTokens } from '../lib/token-estimator';
import { ALL_FIXTURES } from '../fixtures/personas';
import type { EvalFixture } from '../schema/case.schema';

/** §4.1: rendered prompts may not contain these. */
export const FORBIDDEN_STRINGS = ['undefined', 'null', '[object Object]', 'NaN'];

/**
 * Per-phase system-prompt budget in estimated tokens. P2 replaces these with
 * PhaseSpec.budget.system; until then they are a ceiling generous enough to
 * pass today's prompts and tight enough to catch runaway growth.
 */
export const PHASE_TOKEN_BUDGET: Record<string, number> = {
  registration: 4000,
  chat: 4000,
  plan_creation: 8000,
  session_planning: 12000,
  training: 8000,
};

export const EVAL_PHASES = ['registration', 'chat', 'plan_creation', 'session_planning', 'training'];

export function checkRenderedPrompt(phase: string, fixtureName: string, rendered: string): CheckResult[] {
  const caseName = `${phase}/${fixtureName}`;
  const results: CheckResult[] = [];

  results.push({
    case: caseName,
    check: 'renders-non-empty',
    passed: rendered.trim().length > 0,
    detail: rendered.trim().length > 0 ? undefined : 'rendered prompt is empty',
  });

  const hits = FORBIDDEN_STRINGS.filter(s => rendered.includes(s));
  results.push({
    case: caseName,
    check: 'no-forbidden-strings',
    passed: hits.length === 0,
    detail: hits.length > 0 ? `contains ${hits.join(', ')}` : undefined,
  });

  const tokens = estimateTokens(rendered);
  const budget = PHASE_TOKEN_BUDGET[phase] ?? 8000;
  results.push({
    case: caseName,
    check: 'within-token-budget',
    passed: tokens <= budget,
    detail: tokens <= budget ? undefined : `${tokens} estimated tokens exceeds budget ${budget}`,
  });

  return results;
}

async function renderPrompt(phase: string, fixture: EvalFixture): Promise<string> {
  const user = fixture.user as never;
  switch (phase) {
    case 'chat': {
      const { buildChatSystemPrompt } = await import('@infra/ai/graph/nodes/chat.node');
      return buildChatSystemPrompt(user, fixture.hasActivePlan ?? false, [], null);
    }
    // Add one arm per phase, using the exact builder name and signature from Step 1.
    default:
      throw new Error(`No L0 renderer wired for phase ${phase}`);
  }
}

export async function runL0(phaseArg: string): Promise<CheckResult[]> {
  const phases = phaseArg === 'all' ? EVAL_PHASES : [phaseArg];
  const results: CheckResult[] = [];

  for (const phase of phases) {
    for (const { name, fixture } of ALL_FIXTURES) {
      try {
        results.push(...checkRenderedPrompt(phase, name, await renderPrompt(phase, fixture)));
      } catch (err) {
        results.push({
          case: `${phase}/${name}`,
          check: 'renders-without-throwing',
          passed: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return results;
}
```

The `@infra/*` alias must resolve under `tsx`. If it does not, add `tsconfig-paths` to the `evals` script or use a relative import — verify in Step 7 rather than assuming.

- [x] **Step 6: Run the unit test to confirm it passes**

Run: `npm run test:unit -- l0`
Expected: PASS, all five cases.

- [x] **Step 7: Run the real thing (AC-1303, L0 half)**

Run: `npm run evals -- --level L0`
Expected: exit 0, with a line like `L0: 15/15 checks passed, 0 failed` (five phases × three fixtures × three checks, once every arm is wired).

If a **real** prompt fails a check, do not edit the prompt. Record the failure in `docs/BACKLOG.md` via the `backlog` skill, and — only if the failure is a genuine budget miscalibration rather than a prompt defect — adjust that phase's entry in `PHASE_TOKEN_BUDGET` with a comment saying what it was measured at.

- [x] **Step 8: Commit**

```bash
git add evals/
git commit -m "feat(evals): implement L0 static prompt checks across five phases and three fixtures"
```

---

### Task 4: Gate L0 in CI

An offline check that nobody runs is not a safety net. L0 costs seconds and no tokens, so it joins the existing PR job.

**Files:**
- Modify: `.github/workflows/ci.yml:62` (add an L0 step after "Unit tests")

**Interfaces:**
- Consumes: the `evals` npm script (Task 1) and `runL0` (Task 3).
- Produces: a required-check failure whenever a prompt renders with a hole or blows its budget.

- [x] **Step 1: Add the CI step**

In `.github/workflows/ci.yml`, after the "Unit tests" step in the `check-server` job:

```yaml
      - name: Eval L0 (static prompt checks)
        run: npm run evals -- --level L0
```

The job already writes `.env.test` with `LLM_MODEL=mock` and a dummy `LLM_API_KEY`; L0 makes no network call, so those placeholders are enough.

- [x] **Step 2: Verify the script works with only CI's env**

Run: `NODE_ENV=test npm run evals -- --level L0`
Expected: exit 0. If the run fails because `--env-file=.env` is missing in CI, change the npm script to `tsx evals/run.ts` and load env only where a later level needs it.

- [x] **Step 3: Confirm the drizzle guard still passes**

Run (from the repo root): `grep -rn "drizzle-kit push\|drizzle:push" apps/server deploy docker-compose.yml --exclude-dir=node_modules`
Expected: no output. The CI guard fails the build on any hit, and `evals/` is inside `apps/server`.

- [x] **Step 4: Commit**

```bash
git add ../../.github/workflows/ci.yml
git commit -m "ci: run eval L0 static prompt checks on every PR"
```

- [ ] **Step 5: Confirm the gate fires on the PR**

Open the PR and wait for `check-server`. Expected: the "Eval L0" step appears and passes. Paste its output line into the PR description.

---

## Execution notes (deviations from the drafted plan)

- **Builders found (Task 3 Step 1)** — one exported builder per phase, all in `src/infra/ai/graph/nodes/`:
  `buildRegistrationSystemPrompt(user)`, `buildChatSystemPrompt(user, hasActivePlan, recentSessions, lastMessageTime)`,
  `buildPlanCreationSystemPrompt(user)`, `buildSessionPlanningSystemPrompt(user, context)`,
  `buildTrainingSystemPrompt(user, session, previousSession)`. The last two need real
  `SessionPlanningContextData` / `WorkoutSessionWithDetails` objects, so `l0.ts` builds minimal
  structurally-complete ones rather than passing the persona through directly.
- **Fixture user types** — the drafted `FixtureUserSchema` typed `height`/`weight` as strings; the
  production `User` type has them as numbers. The schema follows the real type.
- **Forbidden-string check: strict scan plus an explicit allowlist (owner ruling).** A plain
  `includes` flagged all three training fixtures on the training prompt's RULE 7, which contains
  the ordinary English phrase "Sets without order may execute in undefined sequence" — prose, not a
  template hole. §4.1 forbids editing prompt wording, and this is not a budget miscalibration, so
  neither of the plan's escape hatches applied. The owner ruled against a pattern-based
  "value position" heuristic: the check keeps the spec's strict `rendered.includes(token)`, and
  `FORBIDDEN_STRING_ALLOWLIST` holds exact literal phrases that are stripped from the text before
  scanning. Seeded with that one phrase only. Any new occurrence of a forbidden token still fails,
  including a near-miss of the allowlisted phrase — pinned by a unit test. `training.node.ts` is
  untouched. The proper fix is P2's structural check, which validates substituted values rather
  than scanning the rendered string.
- **Token headroom recorded.** `PHASE_TOKEN_BUDGET` values are unchanged; a comment above them now
  records the measured min-max across the three fixtures as a recalibration baseline:
  registration 935-969, chat 1006-1046, plan_creation 1378-1385, session_planning 2199-2215,
  training 3391-3396.
- **`evals` npm script** — `tsx --env-file=.env` fails in CI, which writes `.env.test` only.
  Per Task 4 Step 2's fallback the script is plain `tsx evals/run.ts`; L0 needs no env at all.
- **Section presence is NOT implemented.** This plan's Architecture line commits L0 to "section
  presence, token budget and forbidden strings", and three checks shipped per case:
  `renders-non-empty`, `no-forbidden-strings`, `within-token-budget`. There is deliberately no
  section-presence assertion: no PhaseSpec or declared section contract exists yet — P2 introduces
  it — so there is nothing to assert presence *against*. Asserting against section headings scraped
  from today's prompt text would pin the current wording rather than a contract, and would break on
  any legitimate prompt edit. The check belongs with P2's PhaseSpec, not here.
- **Version discipline and message-catalog completeness (§4.1) are also out of scope here.** Both
  presuppose artefacts P0 has not built: prompt version identifiers (§6's `promptVersion`, which the
  baseline plan introduces) and a message catalogue. L0 as shipped covers the three checks that need
  nothing beyond a rendered string. The remaining §4.1 checks are tracked in `docs/BACKLOG.md`.

## Close-out

Follow `superpowers:finishing-a-development-branch`. Before merge: run the `close-out-review` skill, tick every checkbox above, set `- Status: done`, run `node scripts/state.mjs --write` from the repo root, and commit. `node scripts/state.mjs --check` must pass.
