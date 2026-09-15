# Refactor P1 — Legacy LLM Path Retirement Implementation Plan

- Status: planned
- Branch: plan/refactor-p1-legacy-llm-retirement
- After: refactor-p0-transcript-export

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One LLM access path. Delete the second, un-evaluated one — `LLMService` and the four `TrainingService` methods whose prompts are fused into service code — and put a `LlmGateway` port with per-profile models in its place.

**Architecture:** `getModel(profile)` becomes the single `ChatOpenAI` construction site with optional per-profile overrides from config. A thin `LlmGateway` (`chat`, `structured`) wraps it for non-graph callers. The two mini-app endpoints that were the only consumers of the legacy path return `410 RETIRED` (ADR-0013 OQ-1, owner-confirmed direction), so the four service methods, their inline prompts, the one extracted legacy prompt file, `LLMService` and its port are deleted rather than migrated. Nothing the bot does changes: the graph subgraphs keep calling `getModel()` exactly as today.

**Why this plan exists (context for the executor):** an audit on 2026-09-13 found that the L0 eval grid covers only the five phase system prompts; six more prompt strings live inside `training.service.ts` methods, mixed with DB reads and model calls, and cannot be rendered or checked. That is not an eval gap to fix by extraction — those prompts belong to the legacy path the master plan retires. This plan is the fix: the prompts leave with the path. The remaining live prompt text outside the grid (summariser, training tool-results block, history/summary frames, post-tool nudge) is handled by `refactor-p2-prompt-modules`.

**Tech Stack:** TypeScript, Fastify (zod route schemas), `@langchain/openai` `ChatOpenAI` + `withStructuredOutput`, Zod, Jest.

**Spec:** `docs/adr/0013-llm-core-target-architecture.md` §7 (D-10), §11 (module layout), §12 OQ-1. Master plan: `docs/LLM_CORE_REFACTOR_PLAN.md` § P1 (scope items 1–5; AC-1311..AC-1314).

**Acceptance criteria:** AC-1311 (`grep -rn "jsonMode\|json_object\|LLMService" apps/server/src` → empty), AC-1312 (410 contract + grep for the four method names → empty + API_SPEC marks both retired), AC-1313 (exactly one `ChatOpenAI` construction site), AC-1314 (`getModel('summarizer')` with no `LLM_PROFILE_*` set behaves identically to defaults).

## Global Constraints

- **Plumbing phase: no prompt wording changes** (master plan, cross-phase rules). The only prompt text that disappears is the legacy path's own; every prompt the bot uses today is byte-untouched. `phase-summary.node.ts` is **not** switched to the gateway here — see "Deferred: summariser via `structured`" at the end; it is an owner ruling, not an executor decision.
- **OQ-1 precondition is a hard gate.** Task 1 checks prod access logs. Real traffic on either endpoint stops the plan (status stays `planned`, `STATE.md` → *Blocked / waiting on owner*); nothing is retired silently.
- **Domain imports no LangChain.** The new port takes the domain's own message shape (`ChatMsg`, `domain/ai/types.ts`) and returns plain data. ADR-0013 §7 words the port with `AIMessage`; INV-CONV-004 and P3's AC-1333 forbid `@langchain/*` in `domain/**`, so the port stays LangChain-free and the infra implementation does the conversion. `ChatMsg` itself stays until P4 removes the last consumer (`getMessagesForPrompt`).
- **No new required env vars.** `LLM_PROFILE_<NAME>_{MODEL,TEMPERATURE,MAX_TOKENS}` are optional overrides; an env with none of them behaves exactly as today (AC-1314).
- **Run-metrics contract** (see `src/infra/ai/run-metrics.ts` and the backlog finding on it): a call bound to a conversation run passes `runId` in `metadata`; a job call (no run) must pass `runId: undefined` explicitly so a drained accumulator is never re-opened. The gateway is the one place that encodes this for non-graph callers.
- **Mini-app is frozen except for one bounded fix (owner ruling, 2026-09-13).** `apps/webapp` is a frozen product surface, but shipping the 410 without touching it would leave a **request loop**, not merely an error state: `PlanningView`'s effect re-fires on every `recommending` transition while `plan` stays null (`PlanningView.tsx:37-41`), so a retired endpoint would be polled indefinitely by every client opening a session without a plan. Task 6 therefore makes the minimum change that stops the loop and shows an honest message. No redesign, no new screens, no new endpoints.
- Verification commands run from `apps/server/` unless stated otherwise.
- Commit messages carry no attribution lines.

## Prompt inventory touched by this plan (the six "fused" strings)

| # | Location (today) | Text | Fate |
|---|---|---|---|
| L1 | `training.service.ts:92-133` `createPlanFromPrompt` | user prompt "Create a workout plan for: …" (JSON schema in prose) | deleted with the method |
| L2 | `training.service.ts:135-139` | system prompt "You are an expert fitness coach. Create a detailed workout plan. Return valid JSON only." | deleted |
| L3 | `training.service.ts:182-186` `getNextSessionRecommendation` | system prompt "You are an expert fitness coach analyzing training history …" | deleted |
| L4 | `domain/training/services/prompts/session-recommendation.prompt.ts` | user prompt (the only extracted legacy prompt; sole consumer = L3's method) | file deleted |
| L5 | `training.service.ts:210-216` `recommendForSession` | adjust prompt + system prompt "…Adjust the workout plan based on user feedback. Return valid JSON only." | deleted |
| L6 | `training.service.ts:641-673` `generateFreeformRecommendation` | "# CLIENT PROFILE … # TASK …" + system prompt | deleted |

After this plan, `grep -rn "Return valid JSON only" apps/server/src` is empty and every remaining model-facing string is either a graph phase prompt (already in L0) or one of the items listed in `refactor-p2-prompt-modules` § Inventory.

---

### Task 1: OQ-1 precondition — verify the retired endpoints have no real traffic

The master plan and ADR-0013 §12 mark "nobody uses them in prod" as an [ASSUMPTION]. This task turns it into a fact or stops the plan.

**Files:**
- Modify: this plan file (fill in the "OQ-1 verification" section below)

**Checks:**
- Deterministic: request counts for `POST /api/app/plan` and `POST /api/app/session/*/recommend` on prod over the last 30 days, from server logs.
- Manual observation: the webapp's `PlanningView` auto-calls the recommend endpoint when a session has no plan (`apps/webapp/src/features/session/PlanningView.tsx:37-41`) and re-fires after each failure — fixed by Task 6 of this plan, not deferred.

- [ ] **Step 1: Count prod requests in the server's own request log (pino, 30 days)**

Run from your machine:

```bash
ssh filko.dev "docker logs fitcoach-prod-server --since 720h 2>&1 | grep -E '\"method\":\"POST\"' | grep -cE '\"url\":\"/api/app/(plan|session/[^/\"]+/recommend)\"'"
```

Expected: a number. `0` means no traffic in the retention window. If the container was recreated less recently than 30 days (`docker inspect -f '{{.State.StartedAt}}' fitcoach-prod-server`), say so in the record — the window is then shorter than 30 days.

- [ ] **Step 2: Cross-check the reverse proxy access log**

Nginx Proxy Manager on the VPS keeps per-host access logs in its data volume. Locate and count:

```bash
ssh filko.dev "docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' nginx-proxy-manager 2>/dev/null; ls /srv/docker/nginx-proxy-manager/data/logs/ 2>/dev/null"
```

then, with the discovered `proxy-host-N_access.log` for `fitcoach.filko.dev`:

```bash
ssh filko.dev "zcat -f /srv/docker/nginx-proxy-manager/data/logs/proxy-host-N_access.log* | grep -cE 'POST /api/app/(plan|session/[^/ ]+/recommend)'"
```

If the NPM container or path differs, adapt the path; record what was actually inspected.

- [ ] **Step 3: Record the result in this plan**

Fill in:

```markdown
## OQ-1 verification (Task 1)

- Date: YYYY-MM-DD
- Server log window: <since> → <now> (container started <StartedAt>)
- POST /api/app/plan: <n>; POST /api/app/session/:id/recommend: <n>
- NPM access log inspected: <path or "not available: reason">; counts: <n>/<n>
- Webapp impact: PlanningView auto-calls recommend when a session has no plan and re-fires on each
  failure; Task 6 of this plan removes the auto-call so the 410 cannot be polled in a loop.
- Ruling: proceed | STOP (traffic found → surfaced to owner on <date>)
```

- [ ] **Step 4: Gate**

If any count is greater than zero: stop, set `STATE.md` *Blocked / waiting on owner* with the numbers, do not continue to Task 2. If all counts are zero: continue.

- [ ] **Step 5: Commit the record**

```bash
git add docs/superpowers/plans/refactor-p1-legacy-llm-retirement.md
git commit -m "docs(plan): record OQ-1 prod traffic check for refactor-p1-legacy-llm-retirement"
```

---

### Task 2: Model profiles — `getModel(profile)` with optional config overrides

Master plan P1 item 2. AC-1313 (one construction site) and AC-1314 (defaults unchanged).

**Files:**
- Create: `apps/server/src/config/llm-profiles.ts`
- Create: `apps/server/src/config/__tests__/llm-profiles.unit.test.ts`
- Modify: `apps/server/src/config/index.ts` (add `LLM_PROFILES` to the loaded config)
- Modify: `apps/server/src/infra/ai/model.factory.ts` (profile parameter, per-profile cache)
- Create: `apps/server/src/infra/ai/__tests__/model.factory.unit.test.ts`

**Interfaces:**
- Consumes: `loadConfig()` from `@config/index`.
- Produces:

```typescript
// config/llm-profiles.ts
export interface LlmProfileOverride { model?: string; temperature?: number; maxTokens?: number }
export function parseLlmProfiles(env: NodeJS.ProcessEnv): Record<string, LlmProfileOverride>;

// config/index.ts — Env gains:
//   LLM_PROFILES: Record<string, LlmProfileOverride>

// infra/ai/model.factory.ts
export function getModel(profile?: string): ChatOpenAI;      // default 'default'
export function resetModelCacheForTests(): void;
```

Task 3's gateway calls `getModel(opts.profile)`.

- [ ] **Step 1: Write the failing profile-parser test**

Create `apps/server/src/config/__tests__/llm-profiles.unit.test.ts`:

```typescript
import { parseLlmProfiles } from '../llm-profiles';

describe('parseLlmProfiles (AC-1314 — optional per-profile overrides)', () => {
  it('returns an empty map when no LLM_PROFILE_* variable is set', () => {
    expect(parseLlmProfiles({ LLM_MODEL: 'x', OTHER: 'y' })).toEqual({});
  });

  it('collects model, temperature and maxTokens per lower-cased profile name', () => {
    const profiles = parseLlmProfiles({
      LLM_PROFILE_SUMMARIZER_MODEL: 'z-ai/glm-5.3-flash',
      LLM_PROFILE_SUMMARIZER_TEMPERATURE: '0',
      LLM_PROFILE_JUDGE_MAX_TOKENS: '2048',
    });
    expect(profiles).toEqual({
      summarizer: { model: 'z-ai/glm-5.3-flash', temperature: 0 },
      judge: { maxTokens: 2048 },
    });
  });

  it('ignores empty values', () => {
    expect(parseLlmProfiles({ LLM_PROFILE_SUMMARIZER_MODEL: '   ' })).toEqual({});
  });

  it('rejects a non-numeric temperature and a non-integer max tokens', () => {
    expect(() => parseLlmProfiles({ LLM_PROFILE_A_TEMPERATURE: 'warm' })).toThrow(/LLM_PROFILE_A_TEMPERATURE/);
    expect(() => parseLlmProfiles({ LLM_PROFILE_A_MAX_TOKENS: '1.5' })).toThrow(/LLM_PROFILE_A_MAX_TOKENS/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- llm-profiles`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `apps/server/src/config/llm-profiles.ts`:

```typescript
/**
 * Optional per-profile model overrides — ADR-0013 §7 (D-10), master plan P1 item 2.
 *   LLM_PROFILE_<NAME>_MODEL, LLM_PROFILE_<NAME>_TEMPERATURE, LLM_PROFILE_<NAME>_MAX_TOKENS
 * Absent variables mean "use LLM_MODEL / LLM_TEMPERATURE / the default max tokens".
 * This is the one deliberate exception to "no defaults in code" in config/index.ts:
 * the defaults are the existing required variables, not literals.
 */
export interface LlmProfileOverride {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

const PROFILE_KEY = /^LLM_PROFILE_([A-Z0-9_]+)_(MODEL|TEMPERATURE|MAX_TOKENS)$/;

export function parseLlmProfiles(env: NodeJS.ProcessEnv): Record<string, LlmProfileOverride> {
  const profiles: Record<string, LlmProfileOverride> = {};

  for (const [key, raw] of Object.entries(env)) {
    const match = PROFILE_KEY.exec(key);
    if (!match || raw == null || raw.trim() === '') continue;

    const name = match[1].toLowerCase();
    const field = match[2];
    const profile = (profiles[name] ??= {});

    if (field === 'MODEL') {
      profile.model = raw.trim();
    } else if (field === 'TEMPERATURE') {
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0 || n > 2) throw new Error(`${key} must be a number in [0, 2]`);
      profile.temperature = n;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be a positive integer`);
      profile.maxTokens = n;
    }
  }

  return profiles;
}
```

- [ ] **Step 4: Run the parser test**

Run: `npm run test:unit -- llm-profiles`
Expected: PASS (4 tests).

- [ ] **Step 5: Expose profiles from `loadConfig()`**

In `apps/server/src/config/index.ts`:

```typescript
import { type LlmProfileOverride, parseLlmProfiles } from './llm-profiles';
// ...
export type Env = z.infer<typeof EnvSchema> & { PORT: number; LLM_PROFILES: Record<string, LlmProfileOverride> };

export function loadConfig(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // unchanged
  }
  const data = parsed.data as Omit<Env, 'LLM_PROFILES'>;
  return { ...data, PORT: data.PORT, LLM_PROFILES: parseLlmProfiles(process.env) } as Env;
}
```

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 6: Write the failing model-factory test (AC-1314)**

Create `apps/server/src/infra/ai/__tests__/model.factory.unit.test.ts`:

```typescript
import { getModel, resetModelCacheForTests } from '../model.factory';

const PROFILE_VARS = ['LLM_PROFILE_SUMMARIZER_MODEL', 'LLM_PROFILE_SUMMARIZER_TEMPERATURE', 'LLM_PROFILE_SUMMARIZER_MAX_TOKENS'];

describe('getModel(profile) (AC-1314 — no LLM_PROFILE_* means identical to defaults)', () => {
  beforeEach(() => {
    for (const v of PROFILE_VARS) delete process.env[v];
    resetModelCacheForTests();
  });

  it('falls back to LLM_MODEL / LLM_TEMPERATURE for an unconfigured profile', () => {
    const def = getModel();
    const summarizer = getModel('summarizer');
    expect(summarizer.model).toBe(def.model);
    expect(summarizer.model).toBe(process.env.LLM_MODEL);
    expect(summarizer.temperature).toBe(def.temperature);
  });

  it('applies LLM_PROFILE_<NAME>_* overrides to that profile only', () => {
    process.env.LLM_PROFILE_SUMMARIZER_MODEL = 'vendor/tiny-model';
    process.env.LLM_PROFILE_SUMMARIZER_TEMPERATURE = '0';
    resetModelCacheForTests();
    expect(getModel('summarizer').model).toBe('vendor/tiny-model');
    expect(getModel('summarizer').temperature).toBe(0);
    expect(getModel().model).toBe(process.env.LLM_MODEL);
  });

  it('caches one instance per profile', () => {
    expect(getModel('summarizer')).toBe(getModel('summarizer'));
    expect(getModel('summarizer')).not.toBe(getModel());
    expect(getModel()).toBe(getModel('default'));
  });
});
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `npm run test:unit -- model.factory`
Expected: FAIL — `resetModelCacheForTests` is not exported / `getModel` ignores its argument.

- [ ] **Step 8: Implement profiles in the factory**

Replace the body of `apps/server/src/infra/ai/model.factory.ts`:

```typescript
import { ChatOpenAI } from '@langchain/openai';

import { loadConfig } from '@config/index';

import { LLMLogHandler } from '@infra/ai/llm-log-handler';

const DEFAULT_MAX_TOKENS = 4096;
const models = new Map<string, ChatOpenAI>();

/**
 * The single ChatOpenAI construction site (ADR-0013 D-10, AC-1313).
 * `profile` selects optional overrides from LLM_PROFILE_<NAME>_* (config/llm-profiles.ts);
 * an unconfigured profile is identical to 'default' (AC-1314). One instance per profile.
 */
export function getModel(profile = 'default'): ChatOpenAI {
  const cached = models.get(profile);
  if (cached) return cached;

  const config = loadConfig();
  const override = config.LLM_PROFILES[profile] ?? {};

  const model = new ChatOpenAI({
    model: override.model ?? config.LLM_MODEL,
    temperature: override.temperature ?? config.LLM_TEMPERATURE,
    maxTokens: override.maxTokens ?? DEFAULT_MAX_TOKENS,
    apiKey: config.LLM_API_KEY,
    configuration: config.LLM_API_URL ? { baseURL: config.LLM_API_URL } : undefined,
    callbacks: [new LLMLogHandler()],
  });

  models.set(profile, model);
  return model;
}

/** Test-only: drop cached instances so env overrides can be re-read. */
export function resetModelCacheForTests(): void {
  models.clear();
}
```

- [ ] **Step 9: Run the factory test and the whole unit suite**

Run: `npm run test:unit -- model.factory` then `npm run test:unit`
Expected: PASS; no other test changes behaviour (every existing caller uses `getModel()` with no argument).

- [ ] **Step 10: Commit**

```bash
git add src/config/llm-profiles.ts src/config/__tests__/llm-profiles.unit.test.ts src/config/index.ts src/infra/ai/model.factory.ts src/infra/ai/__tests__/model.factory.unit.test.ts
git commit -m "feat(llm): per-profile model overrides via LLM_PROFILE_* and getModel(profile)"
```

---

### Task 3: `LlmGateway` port and implementation

Master plan P1 item 1. The port lives under `domain/ai/ports/` (matches the `ports-layout-consistency` rule: ports in a `ports/` directory with an `index.ts`); the old monolithic `domain/ai/ports.ts` is deleted in Task 5 once `LLMService` has no consumers.

**Files:**
- Create: `apps/server/src/domain/ai/ports/llm.gateway.ports.ts`
- Create: `apps/server/src/domain/ai/ports/index.ts`
- Create: `apps/server/src/infra/ai/llm.gateway.ts`
- Create: `apps/server/src/infra/ai/__tests__/llm.gateway.unit.test.ts`
- Modify: `apps/server/src/main/register-infra-services.ts:52-55` (register the gateway next to the still-present LLMService; LLMService goes in Task 5)

**Interfaces:**
- Consumes: `getModel(profile)` (Task 2), `ChatMsg` (`@domain/ai/types`).
- Produces:

```typescript
// domain/ai/ports/llm.gateway.ports.ts
export interface LlmCallOptions {
  profile?: string;        // model profile name, default 'default'
  runId?: string;          // conversation run this call belongs to (metrics binding)
  jobId?: string;          // background job id when there is no run
  userId?: string;         // debug-log correlation only
  schemaName?: string;     // structured(): tool/function name shown to the model
}
export interface LlmGateway {
  chat(messages: ChatMsg[], opts?: LlmCallOptions): Promise<{ content: string }>;
  structured<T>(schema: ZodType<T>, messages: ChatMsg[], opts?: LlmCallOptions): Promise<T>;
}
export const LLM_GATEWAY_TOKEN: unique symbol;

// infra/ai/llm.gateway.ts
export class OpenAiLlmGateway implements LlmGateway
```

- [ ] **Step 1: Write the port**

Create `apps/server/src/domain/ai/ports/llm.gateway.ports.ts`:

```typescript
import type { ZodType } from 'zod';

import type { ChatMsg } from '@domain/ai/types';

/**
 * The one LLM access port for non-graph callers — ADR-0013 §7 (D-10).
 * LangChain-free on purpose (INV-CONV-004): messages are the domain's ChatMsg,
 * results are plain data. Graph subgraphs keep using getModel().bindTools until P3.
 */
export interface LlmCallOptions {
  /** Model profile (config LLM_PROFILE_<NAME>_*); default 'default'. */
  profile?: string;
  /** Conversation run this call belongs to. Binds the call to run metrics. */
  runId?: string;
  /** Background job id when there is no conversation run. */
  jobId?: string;
  /** Debug-log correlation only. */
  userId?: string;
  /** structured(): name of the schema as presented to the model. */
  schemaName?: string;
}

export interface LlmGateway {
  chat(messages: ChatMsg[], opts?: LlmCallOptions): Promise<{ content: string }>;
  structured<T>(schema: ZodType<T>, messages: ChatMsg[], opts?: LlmCallOptions): Promise<T>;
}

export const LLM_GATEWAY_TOKEN = Symbol('LlmGateway');
```

Create `apps/server/src/domain/ai/ports/index.ts`:

```typescript
export * from './llm.gateway.ports';
```

- [ ] **Step 2: Write the failing gateway test**

Create `apps/server/src/infra/ai/__tests__/llm.gateway.unit.test.ts`:

```typescript
import { z, ZodError } from 'zod';

import { OpenAiLlmGateway } from '../llm.gateway';

const invoke = jest.fn();
const structuredInvoke = jest.fn();
const withStructuredOutput = jest.fn(() => ({ invoke: structuredInvoke }));
const getModel = jest.fn(() => ({ invoke, withStructuredOutput }));

jest.mock('@infra/ai/model.factory', () => ({ getModel: (profile?: string) => getModel(profile) }));

describe('OpenAiLlmGateway (ADR-0013 §7 D-10, AC-1311 — the single non-graph LLM path)', () => {
  beforeEach(() => {
    invoke.mockReset();
    structuredInvoke.mockReset();
    withStructuredOutput.mockClear();
    getModel.mockClear();
  });

  it('chat() converts ChatMsg[] to LangChain messages and returns the text content', async () => {
    invoke.mockResolvedValue({ content: 'hello there' });
    const gateway = new OpenAiLlmGateway();

    const result = await gateway.chat(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      { profile: 'summarizer', jobId: 'job-1' },
    );

    expect(result).toEqual({ content: 'hello there' });
    expect(getModel).toHaveBeenCalledWith('summarizer');
    const [messages, config] = invoke.mock.calls[0];
    expect(messages).toHaveLength(2);
    expect(messages[0]._getType()).toBe('system');
    expect(messages[1]._getType()).toBe('human');
    // job call: runId is present-but-undefined so a drained run is never re-opened
    expect(config.metadata).toEqual({ userId: undefined, jobId: 'job-1', runId: undefined });
    expect('runId' in config.metadata).toBe(true);
  });

  it('chat() flattens content-block arrays to text', async () => {
    invoke.mockResolvedValue({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] });
    const result = await new OpenAiLlmGateway().chat([{ role: 'user', content: 'x' }]);
    expect(result.content).toBe('ab');
  });

  it('structured() returns the parsed object and names the schema', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    structuredInvoke.mockResolvedValue({ topics: ['legs'] });

    const result = await new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }], {
      schemaName: 'episode_summary',
    });

    expect(result).toEqual({ topics: ['legs'] });
    expect(withStructuredOutput).toHaveBeenCalledWith(schema, { name: 'episode_summary' });
  });

  it('structured() retries exactly once on a schema failure', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    structuredInvoke
      .mockRejectedValueOnce(new ZodError([]))
      .mockResolvedValueOnce({ topics: ['back'] });

    const result = await new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }]);

    expect(result).toEqual({ topics: ['back'] });
    expect(structuredInvoke).toHaveBeenCalledTimes(2);
  });

  it('structured() gives up after the second schema failure', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    structuredInvoke.mockRejectedValue(new ZodError([]));

    await expect(new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(structuredInvoke).toHaveBeenCalledTimes(2);
  });

  it('structured() does not retry provider errors', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    structuredInvoke.mockRejectedValue(new Error('502 Bad Gateway'));

    await expect(new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }])).rejects.toThrow('502');
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm run test:unit -- llm.gateway`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the gateway**

Create `apps/server/src/infra/ai/llm.gateway.ts`:

```typescript
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { ZodType } from 'zod';

import type { LlmCallOptions, LlmGateway } from '@domain/ai/ports';
import type { ChatMsg } from '@domain/ai/types';

import { getModel } from '@infra/ai/model.factory';

import { createLogger } from '@shared/logger';

const log = createLogger('llm-gateway');

function toLangChain(messages: ChatMsg[]): BaseMessage[] {
  return messages.map(m => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text?: string } => typeof b === 'object' && b !== null && 'type' in b)
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('');
  }
  return '';
}

/**
 * Run-metrics binding (src/infra/ai/run-metrics.ts): `metadata.runId` ties the LLM
 * callback to a run accumulator. A job call has no run, so `runId` is written as an
 * explicit `undefined` — never omitted — so an inherited metadata.runId from an outer
 * config can never re-open an already drained run.
 */
function callConfig(opts: LlmCallOptions): { metadata: Record<string, unknown> } {
  return { metadata: { userId: opts.userId, jobId: opts.jobId, runId: opts.runId } };
}

function isSchemaFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: string }).name;
  return name === 'ZodError' || name === 'OutputParserException';
}

export class OpenAiLlmGateway implements LlmGateway {
  async chat(messages: ChatMsg[], opts: LlmCallOptions = {}): Promise<{ content: string }> {
    const profile = opts.profile ?? 'default';
    const started = Date.now();
    const response = await getModel(profile).invoke(toLangChain(messages), callConfig(opts));
    log.info(
      { profile, runId: opts.runId, jobId: opts.jobId, latencyMs: Date.now() - started, kind: 'chat' },
      'LLM gateway call',
    );
    return { content: textOf(response.content) };
  }

  async structured<T>(schema: ZodType<T>, messages: ChatMsg[], opts: LlmCallOptions = {}): Promise<T> {
    const profile = opts.profile ?? 'default';
    const runnable = getModel(profile).withStructuredOutput(schema, { name: opts.schemaName ?? 'structured_output' });
    const lcMessages = toLangChain(messages);
    const started = Date.now();

    try {
      return await runnable.invoke(lcMessages, callConfig(opts));
    } catch (err) {
      if (!isSchemaFailure(err)) throw err;
      log.warn({ profile, runId: opts.runId, jobId: opts.jobId, err }, 'Structured output failed schema — retrying once');
      return await runnable.invoke(lcMessages, callConfig(opts));
    } finally {
      log.info(
        { profile, runId: opts.runId, jobId: opts.jobId, latencyMs: Date.now() - started, kind: 'structured' },
        'LLM gateway call',
      );
    }
  }
}
```

- [ ] **Step 5: Run the gateway test**

Run: `npm run test:unit -- llm.gateway`
Expected: PASS (6 tests).

- [ ] **Step 6: Register the gateway in DI**

In `apps/server/src/main/register-infra-services.ts`, directly after the existing `LLMService` registration (lines 52-55, removed in Task 5):

```typescript
  const { OpenAiLlmGateway } = await import('@infra/ai/llm.gateway');
  const { LLM_GATEWAY_TOKEN } = await import('@domain/ai/ports');
  container.register(LLM_GATEWAY_TOKEN, new OpenAiLlmGateway());
```

Note: until Task 5 deletes `domain/ai/ports.ts`, `@domain/ai/ports` resolves to the **file** `ports.ts`, not the new directory (TypeScript prefers `ports.ts` over `ports/index.ts`). For this step import the token from `@domain/ai/ports/llm.gateway.ports` explicitly; Task 5 shortens it.

Run: `npm run type-check && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/domain/ai/ports/ src/infra/ai/llm.gateway.ts src/infra/ai/__tests__/llm.gateway.unit.test.ts src/main/register-infra-services.ts
git commit -m "feat(llm): add LlmGateway port and OpenAI implementation over getModel(profile)"
```

---

### Task 4: Retire the two mini-app LLM endpoints and delete the four legacy service methods

Master plan P1 item 3; AC-1312. This is the task that removes prompts L1–L6 from the inventory.

**Files:**
- Modify: `apps/server/src/app/routes/app/plan.routes.ts:29-54` (POST `/plan` → 410)
- Modify: `apps/server/src/app/routes/app/session.routes.ts:282-308` (POST `/session/:id/recommend` → 410)
- Modify: `apps/server/src/domain/training/ports/service.ports.ts:73-78` (remove three method declarations)
- Modify: `apps/server/src/domain/training/services/training.service.ts` (remove `llmService` ctor param, the four methods, the `ChatMsg`/`LLMService`/`buildSessionRecommendationPrompt`/`UserProfile` imports if now unused)
- Delete: `apps/server/src/domain/training/services/prompts/session-recommendation.prompt.ts` (and the now-empty `prompts/` directory)
- Modify: `apps/server/src/main/register-infra-services.ts` (drop `c.get(LLM_SERVICE_TOKEN)` from the `TrainingService` factory)
- Modify: `apps/server/tests/integration/services/training.service.integration.test.ts:3,48` (drop `new LLMService()` argument and import)
- Create: `apps/server/tests/integration/api/app-retired-endpoints.integration.test.ts`
- Create: `apps/server/tests/helpers/init-data.ts` (signed initData builder, lifted from `src/app/middlewares/__tests__/init-data.unit.test.ts:7-30`)
- Modify: `docs/API_SPEC.md` § 4 (add the two endpoints as retired)

**Interfaces:**
- Produces: `POST /api/app/plan` and `POST /api/app/session/:id/recommend` → `410 { error: { code: 'RETIRED' } }` after initData auth (401 on missing/invalid header, unchanged).
- Consumes: nothing from Tasks 2–3 (independent; ordered after them only so a single PR reads top-down).

**Design note — order of checks on the retired routes:** initData auth (`preHandler`, 401) runs first as today; the retired handler then returns 410 **without** touching the database. The previous ownership lookup (`requireSessionOwnership` → 403/404) is not performed for a dead endpoint: a retired route must not read session rows. Consequently the recommend route answers 410 for any well-formed `:id` once the caller is authenticated.

- [ ] **Step 1: Write the signed-initData test helper**

Create `apps/server/tests/helpers/init-data.ts`:

```typescript
import { createHmac } from 'node:crypto';

/**
 * Builds a Telegram WebApp initData string signed with the bot token —
 * the same algorithm validateInitData() checks (src/app/middlewares/init-data.ts).
 * Lifted from src/app/middlewares/__tests__/init-data.unit.test.ts so integration
 * tests can authenticate against /api/app/* routes.
 */
export function buildSignedInitData(
  botToken: string,
  overrides: Partial<{ user: Record<string, unknown>; authDate: number }> = {},
): string {
  const authDate = overrides.authDate ?? Math.floor(Date.now() / 1000);
  const user = JSON.stringify(overrides.user ?? { id: 424242, first_name: 'Retired', username: 'retired_test' });

  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('user', user);

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  params.set('hash', hash);
  return params.toString();
}
```

- [ ] **Step 2: Write the failing integration test (AC-1312)**

Create `apps/server/tests/integration/api/app-retired-endpoints.integration.test.ts`:

```typescript
import { randomUUID } from 'node:crypto';

import { buildServer } from '../../../src/app/server';
import { CONVERSATION_CONTEXT_SERVICE_TOKEN } from '../../../src/domain/conversation/ports';
import { TRAINING_SERVICE_TOKEN } from '../../../src/domain/training/ports';
import { USER_SERVICE_TOKEN } from '../../../src/domain/user/ports';
import { getGlobalContainer, registerInfraServices } from '../../../src/main/register-infra-services';
import { buildSignedInitData } from '../../helpers/init-data';

const describeIfDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeIfDb('Retired mini-app LLM endpoints (AC-1312, ADR-0013 OQ-1)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let initData: string;

  beforeAll(async () => {
    const container = getGlobalContainer();
    await registerInfraServices(container);
    app = buildServer();
    app.decorate('services', {
      userService: container.get(USER_SERVICE_TOKEN) as never,
      conversationContextService: container.get(CONVERSATION_CONTEXT_SERVICE_TOKEN) as never,
      trainingService: container.get(TRAINING_SERVICE_TOKEN) as never,
      conversationGraph: { invoke: jest.fn() } as never,
    });
    await app.ready();
    initData = buildSignedInitData(process.env.TELEGRAM_TOKEN!);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/app/plan still enforces auth first (401 without initData)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/app/plan', payload: { goal: 'strength', daysPerWeek: 3 } });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/app/plan returns 410 RETIRED for an authenticated caller', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/app/plan',
      headers: { 'x-init-data': initData },
      payload: { goal: 'strength', daysPerWeek: 3 },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ error: { code: 'RETIRED' } });
  });

  it('POST /api/app/session/:id/recommend still enforces auth first (401 without initData)', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/app/session/${randomUUID()}/recommend`, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/app/session/:id/recommend returns 410 RETIRED without reading the session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/app/session/${randomUUID()}/recommend`,
      headers: { 'x-init-data': initData },
      payload: { comment: 'more legs' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ error: { code: 'RETIRED' } });
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm run test:integration -- app-retired-endpoints`
Expected: the two 410 tests FAIL (today: 200 with an LLM call attempt, or a thrown error); the 401 tests pass already.

- [ ] **Step 4: Retire `POST /plan`**

In `apps/server/src/app/routes/app/plan.routes.ts` replace the `app.post('/plan', …)` block (lines 29-54) with:

```typescript
const HTTP_GONE = 410;
const retiredResponse = z.object({ error: z.object({ code: z.literal('RETIRED') }) });

  // Retired — ADR-0013 §7 / OQ-1: plan generation is a bot conversation, not a mini-app call.
  app.post(
    '/plan',
    {
      schema: {
        summary: 'Retired: AI plan generation moved to the bot conversation (ADR-0013 OQ-1)',
        security: [{ InitDataAuth: [] }],
        response: { 401: errorResponse, 410: retiredResponse },
      },
    },
    async (req, reply) => {
      if (!req.telegramUserId) {
        return reply.code(HTTP_UNAUTHORIZED).send({ error: { message: 'Not authenticated' } });
      }
      return reply.code(HTTP_GONE).send({ error: { code: 'RETIRED' } });
    },
  );
```

(`HTTP_GONE` and `retiredResponse` go next to the existing `HTTP_UNAUTHORIZED`/`errorResponse` constants at the top of the file.)

- [ ] **Step 5: Retire `POST /session/:id/recommend`**

In `apps/server/src/app/routes/app/session.routes.ts` replace the recommend route (lines 282-308) with:

```typescript
  // Retired — ADR-0013 §7 / OQ-1. Auth still runs (preHandler); no session lookup for a dead route.
  app.post(
    '/session/:id/recommend',
    {
      schema: {
        summary: 'Retired: AI session recommendation moved to the bot conversation (ADR-0013 OQ-1)',
        security: [{ InitDataAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 401: errorResponse, 410: retiredResponse },
      },
    },
    async (req, reply) => {
      if (!req.telegramUserId) {
        return reply.code(HTTP_UNAUTHORIZED).send({ error: { message: 'Not authenticated' } });
      }
      return reply.code(HTTP_GONE).send({ error: { code: 'RETIRED' } });
    },
  );
```

Add `const HTTP_GONE = 410;` and `const retiredResponse = z.object({ error: z.object({ code: z.literal('RETIRED') }) });` beside this file's existing constants.

- [ ] **Step 6: Run the integration test**

Run: `npm run test:integration -- app-retired-endpoints`
Expected: PASS (4 tests).

- [ ] **Step 7: Delete the four service methods, the legacy prompt file and the `llmService` dependency**

In `apps/server/src/domain/training/services/training.service.ts`:
- delete `createPlanFromPrompt` (lines 81-149), `getNextSessionRecommendation` (151-192), `recommendForSession` (194-224), `generateFreeformRecommendation` (624-676);
- delete the constructor parameter `private llmService: LLMService,` (line 73);
- delete the imports `LLMService` (`@domain/ai/ports`), `ChatMsg` (`@domain/ai/types`), `buildSessionRecommendationPrompt`, and `UserProfile` from the `@domain/training/types` import if nothing else uses it (check with `grep -n UserProfile` in the file).

In `apps/server/src/domain/training/ports/service.ports.ts` delete the three declarations at lines 73-78 (`createPlanFromPrompt`, `getNextSessionRecommendation`, `recommendForSession`). `updateSessionPlan` stays (it is the PATCH route's dependency, not an LLM method).

Delete the file and directory:

```bash
git rm src/domain/training/services/prompts/session-recommendation.prompt.ts
```

In `apps/server/src/main/register-infra-services.ts` remove `c.get(LLM_SERVICE_TOKEN),` from the `new TrainingService(…)` factory.

In `apps/server/tests/integration/services/training.service.integration.test.ts` remove `import { LLMService } from '@infra/ai/llm.service';` (line 3) and the `new LLMService(),` constructor argument (line 48).

- [ ] **Step 8: Verify the tree compiles and the grep half of AC-1312 holds**

Run:

```bash
npm run type-check && npm run lint && npm run test:unit
grep -rn "recommendForSession\|createPlanFromPrompt\|getNextSessionRecommendation\|generateFreeformRecommendation" src
```

Expected: type-check/lint/unit clean; grep prints nothing.

- [ ] **Step 9: Mark both endpoints retired in `docs/API_SPEC.md`**

Append to § 4 (after 4.10 "Training History"):

```markdown
### 4.11 Create Plan via AI — RETIRED
- POST `/api/app/plan`
- Retired 2026-09 (ADR-0013 §7, OQ-1): plan generation is a bot conversation (plan_creation phase).
- Response 410 `{ error: { code: 'RETIRED' } }` for any authenticated caller
- 401 `{ error: { message: string } }` — missing or invalid initData (auth still enforced first)

### 4.12 Session Recommendation via AI — RETIRED
- POST `/api/app/session/:id/recommend`
- Retired 2026-09 (ADR-0013 §7, OQ-1): "what do I do today" is the bot's session_planning phase.
- Response 410 `{ error: { code: 'RETIRED' } }` for any authenticated caller; the session is not read
- 401 `{ error: { message: string } }` — missing or invalid initData
```

- [ ] **Step 10: Commit**

```bash
git add -A src/app/routes/app src/domain/training src/main/register-infra-services.ts tests/helpers/init-data.ts tests/integration ../../docs/API_SPEC.md
git commit -m "refactor(app): retire POST /api/app/plan and /session/:id/recommend (410) and delete the legacy TrainingService LLM methods"
```

---

### Task 5: Delete `LLMService`, its port and registrations (AC-1311, AC-1313)

Master plan P1 item 4.

**Files:**
- Delete: `apps/server/src/infra/ai/llm.service.ts`
- Delete: `apps/server/src/domain/ai/ports.ts` (its only export was `LLMService` + `LLM_SERVICE_TOKEN`; the directory `domain/ai/ports/` from Task 3 takes over the `@domain/ai/ports` specifier)
- Modify: `apps/server/src/main/register-infra-services.ts:52-55` (remove the LLMService block; shorten the gateway token import to `@domain/ai/ports`)
- Modify: `apps/server/src/app/test/setup.ts:155-156` (remove the `LLM_SERVICE_TOKEN` registration and its imports)
- Modify: `docs/ARCHITECTURE.md:45,58` (reconcile the two lines that name the deleted files)
- Create: `apps/server/src/infra/ai/__tests__/single-model-site.unit.test.ts` (AC-1313 guard)

**Checks:**
- AC-1311: `grep -rn "jsonMode\|json_object\|LLMService" src` → empty.
- AC-1313: exactly one `new ChatOpenAI(` in `src/`, pinned by a unit test so it cannot regress silently.

- [ ] **Step 1: Write the failing AC-1313 guard test**

Create `apps/server/src/infra/ai/__tests__/single-model-site.unit.test.ts`:

```typescript
import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('ChatOpenAI construction sites (AC-1313)', () => {
  it('exist exactly once, in model.factory.ts', () => {
    const srcDir = path.resolve(__dirname, '../../..');
    const out = execFileSync('grep', ['-rln', 'new ChatOpenAI(', srcDir, '--include=*.ts'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(f => path.relative(srcDir, f));
    expect(out).toEqual(['infra/ai/model.factory.ts']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- single-model-site`
Expected: FAIL — two files listed (`infra/ai/llm.service.ts` and `infra/ai/model.factory.ts`).

- [ ] **Step 3: Delete the service, the old port file and the registrations**

```bash
git rm src/infra/ai/llm.service.ts src/domain/ai/ports.ts
```

In `apps/server/src/main/register-infra-services.ts` delete lines 52-55 (the `// TODO: remove LLMService …` comment, the two dynamic imports and `container.register(LLM_SERVICE_TOKEN, …)`), and change the gateway token import from Task 3 to `await import('@domain/ai/ports')`.

In `apps/server/src/app/test/setup.ts` delete the block at lines 155-157 (`if (!c.has(LLM_SERVICE_TOKEN)) { c.register(LLM_SERVICE_TOKEN, new LLMService()); }`) and the corresponding `LLMService` / `LLM_SERVICE_TOKEN` imports at the top of the file.

- [ ] **Step 4: Verify AC-1311 and AC-1313**

Run:

```bash
npm run type-check && npm run lint && npm run test:unit
grep -rn "jsonMode\|json_object\|LLMService" src
```

Expected: all green; grep prints nothing; `single-model-site` test passes.

- [ ] **Step 5: Reconcile `docs/ARCHITECTURE.md`**

Line 45: replace `ports.ts                 # ILLMService interface (TODO: remove in refactor P1)` with:

```
      ports/
        llm.gateway.ports.ts   # LlmGateway (chat, structured) — ADR-0013 §7; the only LLM port
        index.ts
```

Line 58: delete the `session-recommendation.prompt.ts` entry (and the `prompts/` directory line above it if it becomes empty).

`docs/domain/ai.spec.md` still documents `LLMService` methods that never existed (ADR-0013 §1.8); it is rewritten in P7 (AC-1371). Do not edit it here — record in the close-out that it is stale and P7-owned.

- [ ] **Step 6: Commit**

```bash
git add -A src/infra/ai src/domain/ai src/main/register-infra-services.ts src/app/test/setup.ts ../../docs/ARCHITECTURE.md
git commit -m "refactor(llm): delete LLMService and its port; LlmGateway over getModel(profile) is the single path (AC-1311, AC-1313)"
```

---

### Task 6: Stop the webapp from polling a retired endpoint

The only mini-app edit this plan makes, and it exists to prevent a defect the 410 would otherwise introduce. `PlanningView`'s effect calls `onRecommend()` whenever `plan` is null and `recommending` is false; `useSession.recommend` swallows the failure and flips `recommending` back to false, which re-satisfies the effect's condition. Today that self-heals because the endpoint answers 200. After Task 4 it is an unbounded retry loop against a dead route.

**Files:**
- Modify: `apps/webapp/src/features/session/PlanningView.tsx:37-41` (delete the auto-recommend effect), `:98-106` (empty-state copy)
- Modify: `apps/webapp/src/shared/hooks/useSession.ts:70-87` (drop `recommend`), `:13-15` (drop it from the hook's interface), `:121` (drop it from the returned object)
- Modify: `apps/webapp/src/features/session/SessionPage.tsx:30,80-81` (stop passing `recommend`/`recommending`)
- Modify: `apps/webapp/src/features/session/PlanningView.tsx` props interface (`:11-16`) — remove `recommending` and `onRecommend`
- Delete: the comment-and-resubmit control that calls `onRecommend(comment)` (`PlanningView.tsx` `handleUpdateComment` and the textarea block around `:155-165`)

**Checks:**
- Deterministic: `grep -rn "recommend" apps/webapp/src` returns nothing.
- Deterministic: `npm run build` in `apps/webapp/` succeeds (no unused-prop or missing-prop type errors).
- Manual observation on dev: opening a session without a plan shows the empty state once, and the browser network panel shows **zero** requests to `/session/:id/recommend`.

**Design note:** the exercise list itself is unaffected. `PlanningView` renders `plan.exercises` and edits them through `onUpdatePlan` (`PATCH /session/:id/plan`), which is **not** retired. What disappears is only the AI auto-fill and the "adjust by comment" box. A session started from the mini-app now shows the empty state until the plan arrives from the bot conversation — which is exactly the product intent recorded in ADR-0013 §9.

- [ ] **Step 1: Delete the auto-recommend effect**

In `apps/webapp/src/features/session/PlanningView.tsx` remove:

```tsx
  useEffect(() => {
    if (!plan && !recommending) {
      void onRecommend();
    }
  }, [plan, recommending, onRecommend]);
```

- [ ] **Step 2: Remove the recommend-driven UI and props**

Remove `recommending` and `onRecommend` from `PlanningViewProps` and from the destructured parameter list. Delete `handleUpdateComment`, the `comment` state, and the textarea/button block that calls it. Delete the `if (recommending && !plan)` spinner branch — with no auto-call there is nothing to wait for.

Replace the empty state so it states the real situation instead of implying a failure:

```tsx
  if (!plan || exercises.length === 0) {
    return (
      <div className={styles.loadingContainer}>
        <Dumbbell size={48} strokeWidth={1.5} />
        <p className={styles.loadingText}>Плана на эту тренировку пока нет. Попроси тренера в чате составить её.</p>
      </div>
    );
  }
```

Drop the now-unused `Spinner` import (and `useEffect` if nothing else uses it — `PlanningView` still has the `plan?.exercises` effect, so it stays).

- [ ] **Step 3: Remove `recommend` from the session hook**

In `apps/webapp/src/shared/hooks/useSession.ts` delete the `recommend` callback (`:70-87`), the `recommending` state (`:28`), the two interface members (`:13-15`), and both from the returned object (`:121`). `plan`, `setPlan` and `updatePlan` all stay — `plan` is still populated from the loaded session.

- [ ] **Step 4: Update the call site**

In `apps/webapp/src/features/session/SessionPage.tsx` stop destructuring `recommend, recommending` (`:30`) and stop passing them to `PlanningView` (`:80-81`).

- [ ] **Step 5: Verify**

Run from `apps/webapp/`:

```bash
npm run build
```

Expected: a clean build. Then from the repo root:

```bash
grep -rn "recommend" apps/webapp/src
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src
git commit -m "fix(webapp): stop auto-calling the retired recommend endpoint; show a plan-from-chat empty state"
```

---

### Task 7: Phase-level verification and deploy

Cross-phase rules: every PR runs `check-all` + unit tests; from P2 on also `evals L0` — run it here anyway, it is free and proves the graph prompts are untouched.

- [ ] **Step 1: Full local verification**

Run:

```bash
npm run check-all && npm run test:unit && npm run evals -- --level L0
RUN_DB_TESTS=1 npm run test:integration
```

Expected: all green; L0 report unchanged from the `dev` baseline (45/45 at the time of writing).

Then from `apps/webapp/`:

```bash
npm run build
```

Expected: clean build (Task 6).

- [ ] **Step 2: Deploy to dev and smoke**

After merge to `dev` (see Close-out):

```bash
ssh filko.dev "cd /srv/docker/fitcoach && ./deploy/deploy.sh dev"
curl -s -o /dev/null -w '%{http_code}\n' https://fitcoach-dev.filko.dev/health
```

Expected: `200`. Then run the manual smoke list in `docs/MANUAL_TEST_PLAN.md` § "Smoke" against `@MyFitAiCoachDevBot`, and confirm the retirement live:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://fitcoach-dev.filko.dev/api/app/plan
```

Expected: `401` (auth first; a signed initData is needed for the 410, which the integration test covers).

Finally open the dev mini-app, start a session with no plan, and watch the browser network panel: the empty state must render once and **no** request to `/session/:id/recommend` may appear (Task 6).

- [ ] **Step 3: Record results in this plan's close-out**

---

## Decided: summariser via `LlmGateway.structured` is deferred to P4 (master plan P1 item 5)

**Owner ruling, 2026-09-13: defer. Do not implement item 5 in this plan.**

Master plan P1 item 5 switches `phase-summary.node.ts` to `LlmGateway.structured` with the ADR-0013 §3.3 schema (`{ topics[], decisions[], userState[], trainingFeedback[], openItems[] }`) and `profile: 'summarizer'`. Two facts made deferral the stable choice:

1. The summary text is injected into every phase prompt as `CONTEXT FROM PREVIOUS CONVERSATION:`. Rendering it from a structured object changes that text's shape for every phase — a prompt-input change in a plumbing phase, which the master plan's cross-phase rules forbid without a version bump and an eval run. At P1 there is no `v0` baseline comparison wired into this plan, so the change would ship unmeasured.
2. P4 deletes `phase-summary.node.ts` and replaces it with `compact`, which is where the structured summary is actually consumed. Doing the switch in P1 means building the structured→text rendering twice and throwing one away.

Consequences for the executor, all already reflected in the tasks above:

- `phase-summary.node.ts` keeps calling `getModel()` directly. That is still the single `ChatOpenAI` construction site, so **AC-1313 holds** and Task 5's guard test passes unchanged.
- The `structured` path of the gateway ships in Task 3 with unit coverage but has **no production caller** in this plan. That is intended: P4's `compact` is its first consumer. Do not add a caller to satisfy a "dead code" instinct, and do not delete `structured` — a reviewer flagging it should be pointed at this section.
- The `summarizer` model profile likewise ships unused (`LLM_PROFILE_SUMMARIZER_*` remains optional and unset). Task 2's AC-1314 test covers it.
- P4's plan inherits the work: `generatePhaseSummary` → `compact` using `LlmGateway.structured` with the §3.3 schema, `SUMMARY_SYSTEM_PROMPT` carried over from `refactor-p2-prompt-modules`' `summarizer/v1.ts` module, and a `renderSummaryText(summary)` emitting `Topics: … / Decisions: … / User state: … / Training feedback: … / Open items: …`. Record this in P4's `Depends on` when that plan is written.

Record in the close-out that item 5 was deliberately not implemented and why, so `state.mjs --check` and the close-out review do not read it as unfinished scope.

## OQ-1 verification (Task 1)

- Date: 2026-09-16
- Server log window: 2026-09-11 → 2026-09-16 (container started 2026-09-11 — window is 5 days, shorter than 30)
- POST /api/app/plan: 0; POST /api/app/session/:id/recommend: 0 (pino log, `docker logs fitcoach-prod-server --since 720h`)
- NPM access log inspected: `/srv/docker/nginx-proxy-manager/data_npm/logs/proxy-host-14_access.log*`
  (VPS layout differs from Khadas: NPM data is `data_npm/`; host 14 = fitcoach.filko.dev, found by scanning
  all `proxy-host-*_access.log` for the domain; 10581 entries, window 2026-08-17 → 2026-09-15 — full 30 days);
  counts: 0/0. Note: the log line format puts the domain between method and path
  (`POST https fitcoach.filko.dev "/api/..."`), so the grep matches `POST <scheme> <host> "<path>"`.
  The entire log is scanner noise (`.env`, `.git/HEAD` probes); there is no `/api/app/*` traffic at all,
  on any endpoint. The NPM fallback log was also checked: 0/0.
- Webapp impact: PlanningView auto-calls recommend when a session has no plan and re-fires on each
  failure; Task 6 of this plan removes the auto-call so the 410 cannot be polled in a loop.
- Ruling: proceed

## Close-out

Follow `superpowers:finishing-a-development-branch`. Before merge: run the `close-out-review` skill, tick every checkbox above, close every check with its result, set `- Status: done`, run `node scripts/state.mjs --write` from the repo root, and commit. `node scripts/state.mjs --check` must pass. Record here: the L0 report line, the four AC grep outputs, the `apps/webapp` build result and the zero-recommend-request observation from Task 6, the dev smoke result, the note that item 5 (summariser) was deliberately deferred to P4, and the note that `docs/domain/ai.spec.md` remains stale until P7.

## Review

_(recorded by close-out-review)_
