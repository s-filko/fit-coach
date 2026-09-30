# Prompt Caching (BUG-051) — Stable Prefix, Two Breakpoints, No Mid-Workout Rewrites Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and superpowers:test-driven-development. Red tests
> first in every task. Execute only the dispatched task.

- Status: in progress
- Branch: plan/prompt-caching
- After: —

**Goal:** during a workout the request prefix (tools → system prompt → stable blocks → history) is byte-identical
from call to call and grows only by appending; only the current turn changes. Anthropic prompt caching via
OpenRouter then reads everything but the current turn at 0.1× input price. Target: a workout like the 2026-09-29
one costs ≈ $0.6–1 instead of $3.63 (estimate — measured in the live check, AC-PC-8).

**Source:** `docs/BUGS.md` § BUG-051; owner discussion 2026-09-30 (decisions below).

## Findings (2026-09-30)

### Provider behaviour — probed live on the dev key (13 calls, ≈ $0.25, route "Claude Platform on AWS")

Probe: 12 k-token prompt, 6 tools, `anthropic/claude-sonnet-5.5` through `https://openrouter.ai/api/v1/`.

| Probe | cached / written | cost |
|---|---|---|
| top-level `cache_control`, same request twice | 0 / 11 933 → 11 933 / 0 | $0.0301 → $0.0027 |
| same, only the trailing `NOW` SystemMessage changed | 0 / 11 933 (full miss) | $0.0301 |
| same, only the domain SystemMessage (after block 1) changed | full miss | $0.0301 |
| top-level `cache_control`, volatile text moved into the last user message, changed | full miss | $0.0301 |
| **explicit breakpoints** on the system text part + the last history message, volatile text in the last user message, changed | **11 885 / 0** | **$0.0028** |
| top-level `cache_control` with `ttl: "1h"` | write $0.0480, read $0.0027 | |
| write, read at +4 min, read at +8.5 min (5 min TTL) | both reads hit | |

Conclusions:
1. **OpenRouter hoists every SystemMessage into Anthropic's single system prompt**, wherever it sits in the
   array. Any per-turn SystemMessage (domain block, gap note, `NOW`, post-tool nudge) therefore changes the system
   prompt and misses the whole cache.
2. **Automatic (top-level) caching does not survive a changing tail.** Explicit `cache_control` breakpoints on
   content parts do.
3. **A hit refreshes the 5 min TTL.** Rest between sets is 2–3 min, so one 5 min cache lives through a workout.
   1 h TTL works too (write 2× instead of 1.25×).
4. `@langchain/openai` 1.2.9 passes `cache_control` inside content parts through unchanged (checked locally with a
   capturing `fetch`, no network): SystemMessage and AIMessage text parts both.

### What changes call to call today — dev DB, owner's session 2026-09-29 10:15–11:40 UTC, 44 Sonnet calls

From `llm_calls.prompt_hashes` / `cache_diverged_at`:

- system messages 1–3 (phase prompt, facts, summaries): stable, except summaries once (compaction);
- **domain block (block 3): changed in 43 of 44 calls**, diverging 200–1 400 chars in (WORKOUT OVERVIEW first);
- the trailing system message (`NOW` / post-tool nudge): changed in 23 calls;
- **tool set changed twice** (`tools` diverged) — the BUG-008 availability filter hides `delete_last_sets` /
  `update_last_set` until the current exercise has a set (`training.spec.ts:96`); tools are the first thing in the
  prefix, so each flip is a full miss.

### Cache breakers in code (`apps/server/src`)

| # | Where | Breaks because |
|---|---|---|
| B1 | `assemble-context.ts:183` block 3 as SystemMessage | volatile, hoisted into system |
| B2 | `assemble-context.ts:188-189` gap note + `NOW` as SystemMessages | volatile, hoisted |
| B3 | `agent.node.ts:107` `withPostToolNudge` inserts a SystemMessage | every post-tool call changes system |
| B4 | `agent.node.ts:177` + `training.spec.ts:96` dynamic tool filter | tool list changes mid-exercise |
| B5 | `budget.ts:96` `trimHistory` (`strategy: 'last'`) | a sliding window shifts the history start every turn |
| B6 | budget compaction (`compact.ts:138`) mid-workout | rewrites history + summaries while the cache is warm |
| B7 | no `cache_control` sent at all (`model.factory.ts`) | nothing is ever cached |
| B8 | `usage.ts` reads `cache_read` only | cache writes (1.25×) are invisible; cost per workout cannot be computed |

## Owner decisions (2026-09-30)

- **O1** Implement BUG-051 as caching first (this plan); tool-set trimming and BUG-050 later, separately.
- **O2** Everything that can be stable goes into the cached prefix; only the dialogue changes during a workout.
- **O3** No compaction while the cache is warm: compact on the inactivity gap (the cache has expired by then);
  budget compaction and history trimming wait. A hard ceiling stays as a safety net (D5).
- **O4** The history breakpoint moves every turn: the write premium applies only to the new tail (≈ 0.25× of a
  few hundred tokens), every later call reads it at 0.1×.

## Orchestrator decisions (owner may overrule)

- **D1** Breakpoint 1 on the last stable system text part (block 1 + facts + directive + summaries — one
  SystemMessage, text parts, `cache_control` on the last part). Breakpoint 2 on the last message of `history`
  (the turn before `current`). If that message is a ToolMessage or an AIMessage with only tool calls, Task 1
  probes whether a breakpoint there works; fallback = the last message with text.
- **D2** Volatile context (block 3 domain blocks, gap note, `NOW`) becomes a `<context>…</context>` text part
  **prepended to the current HumanMessage in the request only**; the checkpointed message stays the raw user
  text, so history never carries old context. Prompt training v10 (and each phase that renders block 3) says
  where the context now lives.
- **D3** Post-tool nudge: no longer a SystemMessage; rendered as a text part appended to the last ToolMessage's
  content (after breakpoint 2 — uncached tail, never breaks the prefix).
- **D4** Tool availability moves from hiding to rejecting: all phase tools are always bound (stable order);
  `delete_last_sets` / `update_last_set` with no set on the current exercise return a tool error from the
  executor with the same meaning. BUG-008 Plan A's intent (no deletion before a set exists) is kept.
- **D5** Compaction/trim deferral: while the previous call of the same user is younger than
  `LLM_PROMPT_CACHE_TTL_SECONDS`, budget compaction and `trimHistory` are skipped unless the estimated total
  exceeds `LLM_CONTEXT_HARD_CAP_TOKENS` (default 60 000 estimated ≈ 100 k real per BUG-050 — below the model's
  window). Above the cap the existing path runs unchanged.
- **D6** Config: `LLM_PROMPT_CACHE=off|anthropic` (default `off` — Z.AI and the Gemini BYOK route are not
  probed; prod stays untouched), `LLM_PROMPT_CACHE_TTL=5m|1h` (default `5m`). Dev sets `anthropic`, `5m`,
  `LLM_CACHE_TTL_SECONDS=300`. The reordering (D2–D4) is unconditional — it costs nothing on routes without
  caching and keeps one code path.
- **D7** Record `cache_write_tokens` on `llm_calls` (new nullable column, migration) and roll it up on
  `conversation_runs`; read it from the raw provider usage (`prompt_tokens_details.cache_write_tokens`), since
  LangChain's `usage_metadata` has no write field. Attribution (`cache-attribution.ts`) needs no change: its gap
  is measured to the previous call, which matches the refresh-on-hit TTL.

- **D8** Cache-break guard (owner request 2026-09-30: every break is either declared or alerted). Builds on the
  existing `cache-attribution.ts` / `llm_calls.cache_expected`, which today is recorded and never read:
  1. **Declared breaks.** The run context carries the reasons this run is *allowed* to break the prefix, set at
     the code site that causes them: `phase_switch` (block 1 / tool set of a new phase), `compaction` (history /
     summaries rewritten), `hard_cap` (D5 safety net fired), `facts_changed` (course-check or a fact tool changed
     the stable block), `ttl_expired` (gap ≥ TTL). One registry of reasons, one place each is raised.
  2. **Compare only the cacheable part.** Attribution compares up to breakpoint 2 of the previous request; a
     change after it (the current turn) is normal and never flagged.
  3. **Classification per call** (new `cache_break` column): `none` · `planned:<reason>` · **`unplanned:<where>`**
     (prefix diverged, no declared reason covers `where`) · **`unexplained_miss`** (expected warm, provider read
     0 or less than the shared prefix).
  4. **Alerts.** `unplanned:*` and `unexplained_miss` → `log.warn` "Prompt cache break" with user, phase,
     `where`, chars into the part, tokens lost and their cost at list price. `planned:hard_cap` and
     `planned:facts_changed` mid-workout → `log.info` (planned but not standard — optimisation candidates).
  5. **Report.** `scripts/cache-report.ts <userId> <from> <to>` (zero-LLM): hit rate, read/write/uncached tokens,
     cost, and breaks grouped by class and `where`, sorted by money lost — the list of places to optimise.
  6. **Static guard** stays the tests: AC-PC-1/2 fail in CI when a change puts a volatile thing into the prefix,
     before it ever reaches a model.

## Durable spec impact — escalate before merge

- ADR-0013 §3.4 message order: block 3, gap note and `NOW` leave the system message list and ride in the
  current human message (D2); two cache breakpoints.
- ADR-0013 §3.3 compaction triggers: budget compaction deferred while the cache is warm, hard cap (D5).
- ADR-0011 / BUG-008 Plan A: availability by rejection instead of hiding (D4).
- `docs/superpowers/specs/2026-09-26-training-history-context-design.md` § 4 superseded by this plan's findings.

## Acceptance criteria (mints AC-PC-*)

- **AC-PC-1** Two consecutive training runs of one session — a set logged in between, `NOW` a minute later, a
  gap note on the second — produce requests whose tools and messages up to breakpoint 2 of the first are
  byte-identical (serialised request body, mocked model).
- **AC-PC-2** No SystemMessage after the first message in any assembled request, in every phase, including the
  post-tool call and the empty-reply retry.
- **AC-PC-3** With `LLM_PROMPT_CACHE=anthropic` the request carries exactly two `cache_control` parts (D1),
  with `ttl` per config; with `off`, none.
- **AC-PC-4** The bound tool list of a phase does not depend on session state; `delete_last_sets` /
  `update_last_set` before the first set of the current exercise return the executor error (D4).
- **AC-PC-5** The checkpointed HumanMessage carries no `<context>` text (D2).
- **AC-PC-6** Within the TTL, history over `budget.history` but under the hard cap: no compaction, no trim; over
  the cap: current behaviour. After a gap ≥ TTL: current behaviour (D5).
- **AC-PC-7** `llm_calls.cache_write_tokens` and the run rollup are filled from a mocked OpenRouter usage payload.
- **AC-PC-9** A prefix change with no declared reason is recorded `unplanned:<where>` and logged at warn with the
  lost tokens and cost; the same change with its reason declared is `planned:<reason>` and not warned; a change
  after breakpoint 2 is `none` (D8.1–4).
- **AC-PC-10** Expected warm + provider read below the shared prefix → `unexplained_miss`, warned (D8.3–4).
- **AC-PC-11** `cache-report.ts` over seeded `llm_calls` rows prints hit rate, cost split and breaks sorted by
  money lost (D8.5).
- **AC-PC-8** Live check on dev (owner's next workout): `cache_read_tokens > 0` on ≥ 80 % of training calls after
  the first; `cache_expected = warm` with a zero read reported as unexplained misses; cost per workout from
  `cache-report.ts` compared with $3.63; every `unplanned:*` break in the workout explained or turned into a bug.

## Tasks

### T1 — Probe the remaining provider unknowns (≤ 4 calls, dev key) — orchestrator

Breakpoint on a ToolMessage and on a tool-calls-only AIMessage (D1); a second breakpoint position moving forward
by one turn reports `cache_write_tokens` for the delta only (O4). Record results in § Evidence. No code.

### T2 — Red tests AC-PC-1..7 (worker, Sonnet)

`assemble-context` / `agent.node` unit tests over the serialised request (capturing `fetch` on a real
`ChatOpenAI` with the model call mocked, as in the Task 1 LangChain check), executor test for D4, compaction
planner tests for D5, usage extractor + recorder integration test for D7. All red on unchanged code.

### T3 — Stable prefix: D2, D3, D4, prompt v10 (worker, Sonnet)

`assembleContext` emits one stable SystemMessage (text parts) + history + enriched current HumanMessage; nudge
into the ToolMessage; availability → executor rejection; phase prompts that reference block-3 sections get the
one-line location note (version bump each). AC-PC-1, -2, -4, -5 green. Verify: `npm run test:unit`,
`npm run test:scenarios` (self-check), `npm run check-all`.

### T4 — Breakpoints, config, accounting: D1, D6, D7 (worker, GLM)

`cache_control` parts behind `LLM_PROMPT_CACHE`; migration for `cache_write_tokens` (`npm run drizzle:generate`);
extractor reads raw usage. AC-PC-3, -7 green.

### T5 — Compaction deferral: D5 (worker, Sonnet)

AC-PC-6 green; `EPISODE_*` inactivity path untouched.

### T5b — Cache-break guard: D8 (worker, Sonnet)

Reason registry + raising sites, attribution up to breakpoint 2, `cache_break` column (same migration as T4 if
not yet merged), warn/info logs, `scripts/cache-report.ts`. AC-PC-9..11 green, red first.

### T6 — Close-out, dev deploy, env (orchestrator)

Review (close-out-review), set `.env.dev` (`LLM_PROMPT_CACHE=anthropic`, `LLM_PROMPT_CACHE_TTL=5m`,
`LLM_CACHE_TTL_SECONDS=300`, backup first), deploy dev, 3-call smoke: second and third call show
`cache_read_tokens > 0`. AC-PC-8 closes after the owner's workout.

## Evidence (filled by workers)

### T1 — provider probe (orchestrator, 2026-09-30, dev key, 3 calls, ≈ $0.03) — done

| Call | Layout | prompt | cached | written | cost |
|---|---|---|---|---|---|
| A | bp1 on system text part, **bp2 on a ToolMessage** (history ends with a tool result), volatile `<context>` in the user message | 10 326 | 0 | 10 302 | $0.0260 |
| B | one turn appended (user, assistant text), bp2 moved to the new assistant message | 10 437 | 10 302 | **110** | $0.0026 |
| C | as B, only the `<context>` NOW changed | 10 437 | 10 412 | 0 | $0.0023 |

- A ToolMessage breakpoint is honoured (write reaches it) — D1 needs no fallback for tool results. A
  tool-calls-only AIMessage is never the last history message (a tool result always follows it), so it is not
  probed.
- **O4 confirmed:** moving bp2 forward writes only the delta (110 tokens), the earlier prefix is read.

### T2 — red tests AC-PC-1..7, AC-PC-9..11 (worker, Sonnet, 2026-09-30) — done

All files are `*.repro.test.ts` (outside the default testMatch); shared helper `apps/server/src/infra/ai/context/__tests__/request-capture.ts`
(real `ChatOpenAI` + capturing `configuration.fetch` returning a canned completion — no network). Run:
`npx jest --testMatch='**/*.repro.test.ts' src` (DB ones: `db-test-lock.sh bash -c 'RUN_DB_TESTS=1 NODE_ENV=test npx jest --testMatch="**/<file>.repro.test.ts"'`).
Result on unchanged code: every AC has at least one test red for the stated reason; `npm run test:unit` 167 suites / 1721 tests green;
`npm run type-check` clean (the two not-yet-existing modules are loaded with `require`, so tsc stays clean; jest reports
"Cannot find module" until T5b).

**Finding for T4 (changes D7's premise):** with a non-streaming `ChatOpenAI` (@langchain/openai 1.2.9) the raw provider usage is
dropped: `response_metadata` = `{tokenUsage, finish_reason, model_provider, model_name}`, `usage_metadata.input_token_details` has
`cache_read` but no write field. `prompt_tokens_details.cache_write_tokens` therefore never reaches the extractor as things stand —
T4 must capture the raw usage itself (fetch wrapper in `model.factory.ts`, or `__includeRawResponse`). The AC-PC-7 test is
end-to-end (real model → `LLMLogHandler` → recorder input) so it does not fix where.

| AC | File | Red because (first failing assertion on unchanged code) |
|---|---|---|
| AC-PC-1 | `graph/nodes/__tests__/prompt-cache-prefix.repro.test.ts` | tools: `expected ["search_exercises","log_set","complete_current_exercise","finish_training"] … received + "delete_last_sets","update_last_set"` (BUG-008 filter); messages: prefix before the first request's current turn differs — first request has the `WORKOUT OVERVIEW\nsquat: 0 sets` system message and the `NOW (…)` system message, second has `… 1 set` and no NOW |
| AC-PC-2 | same | `systemsAfterFirst` is `[WORKOUT OVERVIEW…, "The user returns after 0 h…", "NOW (user's local time)…"]` (plain), `[…, NOW…, "IMPORTANT: All tool calls are complete…"]` (post-tool), `[WORKOUT OVERVIEW…, NOW…]` (retry) instead of `[]` |
| AC-PC-3 | same + `config/__tests__/prompt-cache-config.repro.test.ts` | `expect(parts).toHaveLength(2)` — received 0 (no `cache_control` sent); 1h: `[]` ≠ two `{type:'ephemeral',ttl:'1h'}`; config: `LLM_PROMPT_CACHE` / `LLM_PROMPT_CACHE_TTL` undefined. *Green guard:* "off → no cache_control" (holds today) |
| AC-PC-4 | `graph/__tests__/training-tool-rejection.repro.test.ts` + prefix test | executor: `Expected "llm_error" Received "ok"` (delete_last_sets), `updateLastSet` called once when it must not be; bound tools: `delete_last_sets`,`update_last_set` missing from the request. *Green guard:* calls go through once a set exists |
| AC-PC-5 | prefix test | `expect("ещё подход").toContain("<context>")` — current user message carries no context (it is in system messages) |
| AC-PC-6 | `context/__tests__/compaction-deferral.repro.test.ts`, `graph/nodes/__tests__/compaction-deferral.repro.test.ts` | `decideCompactReason` `Received "budget"` (expected null within the TTL under the cap); `resolveBudget` history trimmed (`Expected - 352 / + 27` lines: history not left untouched); compact step returns a compaction update instead of `{}`. *Green guards:* over the cap / after TTL / inactivity keep today's behaviour |
| AC-PC-7 | `ai/__tests__/cache-write-usage.repro.test.ts`, `conversation/__tests__/conversation-run-cache-write.repro.test.ts`, `tests/integration/services/cache-break-guard.repro.test.ts` | recorder input `usage.cacheWriteTokens` `Expected 110 Received undefined`; `0` not preserved; `RunMetricsCollector.snapshot().tokensCacheWrite` undefined; run insert lacks `tokensCacheWrite`; DB row `cacheWriteTokens` `Expected 110 Received undefined` |
| AC-PC-9 | `ai/__tests__/cache-break-attribution.repro.test.ts`, `cache-break-reasons.repro.test.ts`, `cache-break-guard.repro.test.ts` | `cacheBreak` `Expected "unplanned:system:facts" Received undefined` (and planned/none/tools/history variants); registry: `Cannot find module '@infra/ai/cache-break-reasons'` (new module); DB: `cacheBreak` undefined |
| AC-PC-10 | attribution + guard tests | `Expected "warm" Received "prefix_changed:history[2]:user"` (today's attribution compares past breakpoint 2 and flags the current turn); `cacheBreak` `Expected "unexplained_miss" Received undefined` |
| AC-PC-11 | `tests/integration/services/cache-report.repro.test.ts` | `Cannot find module '@infra/observability/cache-report'` (new module) |

**Interfaces chosen (T3–T5b implement to these; change a signature → update the test in the same commit):**

- Config (`EnvSchema`): `LLM_PROMPT_CACHE` `'off'|'anthropic'` default `off`; `LLM_PROMPT_CACHE_TTL` `'5m'|'1h'` default `5m`;
  `LLM_CONTEXT_HARD_CAP_TOKENS` positive int default `60000`; `LLM_INPUT_PRICE_PER_MTOK` optional number (USD per 1M uncached input
  tokens, list price — used for lost-cost in warn logs and the report). Flags are read via `loadConfig()` at request time.
- D2 wire shape: the current user message content is a list of text parts, the first `<context>…</context>` (block 3 + gap note + NOW);
  the checkpointed HumanMessage stays the raw text. Breakpoints (D1): `{type:'ephemeral'}` (5m: no `ttl` key; 1h: `ttl:'1h'`) on the
  last part of the single stable system message and on the last content part of the last history message (the one right before the
  current user message); none on in-flight messages.
- D4: rejection is observable through `buildToolExecutor(tools, buildTrainingToolPolicy(tools))` over the real tools with
  `trainingService.getSessionDetails(activeSessionId)` returning the session (in-progress exercise, `sets: []`) — `llm_error`
  ToolMessage, `deleteLastSets`/`updateLastSet` never called. Where the check lives is T3's call; adapt `makeExecutor()` in the test
  if the wiring signature changes.
- D5: `decideCompactReason({… , cacheWarm?: {hardCapTokens, estimatedTotalTokens} | null})`, `resolveBudget({… , cacheWarm?: {hardCapTokens} | null})`
  — the caller passes non-null only when the previous call is younger than the TTL; `EpisodeTunables` gains `cacheTtlMs?`, `hardCapTokens?`
  and `buildCompactStep` derives warmth from `state.lastUserMessageAt` vs the run clock.
- D7: `ExtractedUsage`/recorder `usage.cacheWriteTokens?: number|null` (null = unreported, 0 kept); `RunMetricsCollector.onEnd(id, in, out,
  cacheRead, reasoning, cacheWrite)` → `snapshot().tokensCacheWrite`; `ConversationRunRecord.tokensCacheWrite`
  → `conversation_runs.tokens_cache_write`; `llm_calls.cache_write_tokens` (nullable int).
- D8: `@infra/ai/cache-break-reasons` exports `CACHE_BREAK_REASONS` (the five) and `reasonCovers(reason, where)` (mapping in the test:
  phase_switch → tools, system:prompt; compaction → history[*], system:summaries; hard_cap → history[*], system:summaries;
  facts_changed → system:facts, system:directive; ttl_expired → everything). `attributeCache(prev, {request, inputTokens, now,
  cacheReadTokens?, declaredBreaks?}, limits)` returns additionally `cacheBreak` (`none`|`planned:<reason>`|`unplanned:<where>`|`unexplained_miss`)
  and `cacheBreakLostTokens`; cacheable part = tools + messages before the previous request's last user message; `where` inside the
  stable system message names the block by header offset (`system:prompt|facts|directive|summaries`). `RecordLlmCallInput.cacheBreakReasons?: string[]`;
  columns `llm_calls.cache_break` (text) and `cache_break_lost_tokens` (int). Logging: `'Prompt cache break'` warn for `unplanned:*` /
  `unexplained_miss` with `{userId, where, lostTokens, lostCostUsd}`, info for `planned:hard_cap` / `planned:facts_changed`.
  Cache report: `@infra/observability/cache-report` exports `buildCacheReport({userId, from, to, inputPricePerMTok, cacheTtl?})` and
  `formatCacheReport(report)`; shape in the test header (read 0.1×, write 1.25×/2×, uncached = input − read − write).
- Note: when T3 moves volatile context into the human message, `phase` for the warn log is not known to the recorder — the test
  asserts `userId`, `where`, `lostTokens`, `lostCostUsd` only.

### T3 — stable prefix D2/D3/D4, prompt bumps (worker, Sonnet, 2026-09-30) — done

Verification (apps/server): `npm run check-all` clean (exit 0); `npm run test:unit` 168 suites / 1729 tests green;
`db-test-lock.sh npm run test:scenarios` 23 suites, 415 passed + 1 todo. AC-PC-1/2/4/5 promoted:
`graph/nodes/__tests__/prompt-cache-prefix.unit.test.ts` (AC-PC-1, -2, -4 bound tools, -5) and
`graph/__tests__/training-tool-rejection.unit.test.ts` (AC-PC-4 executor); `assemble-context.unit.test.ts` gained AC-PC-2 (every input at
once → exactly one SystemMessage, first). The AC-PC-3 tests moved to `prompt-cache-breakpoints.repro.test.ts` (still red for T4); the
shared setup is `prompt-cache-harness.ts` (was inline in the T2 file). All other T2 repro files unchanged and still red.

What changed:
- `assembleContext`: ONE stable SystemMessage = block 1 + facts + directive + summaries joined with the section separator (a **string**,
  not text parts — the recorder hashes/dedups string system content and attribution diffs it by header offset; **T4 converts it to
  text parts when it attaches `cache_control`**). Block 3 + gap note + NOW go into a leading `<context>\n…\n</context>` text part of a
  request-only copy of the current HumanMessage (same id); the checkpointed message is never touched. D-D floor unchanged (block 3 dropped,
  gap note/NOW stay).
- `agent.node.ts` D3: the nudge is a text part appended to the LAST ToolMessage (copy; `tool_call_id`/`status` kept); with no ToolMessage
  (empty-reply retry after a plain answer) it is appended to the last message (the current human). No SystemMessage is inserted anywhere.
- D4: all `spec.tools` bound in spec order; `ToolPolicy.availability` and `AvailabilityInput` removed. The BUG-008 Plan A rule now lives in
  the tools: `tools/set-preconditions.ts` `rejectWithoutLoggedSet` (reads `trainingService.getSessionDetails`, current = in-progress
  exercise with 0 sets, same rule as before) called first by `delete_last_sets` / `update_last_set` → `llm_error`. Executor unchanged
  (the T2 test's `makeExecutor` needed no change). Cost: one extra `getSessionDetails` read per delete/update call.
- Prompts: `withContextLocation` (`prompts/phases/context-location.ts`) derives chat v4, plan_creation v4, session_planning v4, training
  v10 from v3/v3/v3/v9 + a non-required `context-location` section (CONTEXT LOCATION one-liner, appended last). Registration is NOT bumped:
  it has no block 3 and its prompt does not refer to NOW/gap note. Rolling `*_PROMPT.current` snapshots and the registry/v9 tests updated.

Frozen snapshots changed by design (`evals/snapshots/__tests__/__snapshots__`): `message-assembly` (15 — one system message, `<context>`
part in the current human, nudge as ToolMessage text part) and `prompt-snapshots` (12 — only the appended CONTEXT LOCATION paragraph in
chat/plan_creation/session_planning/training v-current). Existing tests that pinned the old layout were updated (assemble-context,
agent.node, chat-continuity repro, course-check graph, user-facts scenario) and the scenario helpers that flattened message content now
join text parts (`evals/lib/run-case.ts`, set-kind, retro-timestamps, harness, a-greeting-after-pause).

Interface deviation from T2: none.

### T4 — breakpoints, config, accounting: D1, D6, D7 (worker, Sonnet, 2026-09-30) — done

Verification (apps/server): `npm run check-all` clean; `npm run test:unit` 173 suites / 1756 tests green; `db-test-lock.sh npm run test:scenarios`
23 suites / 415 passed + 1 todo; DB-backed via `db-test-lock.sh` with `RUN_DB_TESTS=1`: `llm-call-cache-write` + `conversation-run-cache-rollup`
+ `llm-call-recorder` integration 3 suites / 26 tests green. **Migration: `apps/server/drizzle/0021_talented_magneto.sql`**
(`llm_calls.cache_write_tokens`, `conversation_runs.tokens_cache_write`, both nullable int; generated with `npm run drizzle:generate`; the test
harness applies migrations itself, nothing was run against dev/prod). Promoted from repro: AC-PC-3 (`prompt-cache-breakpoints.unit.test.ts`,
`prompt-cache-config.unit.test.ts` — the D6 flags only; the `LLM_CONTEXT_HARD_CAP_TOKENS` / `LLM_INPUT_PRICE_PER_MTOK` tests stay in
`prompt-cache-config.repro.test.ts` for T5/T5b) and AC-PC-7 (`cache-write-usage.unit.test.ts`, `conversation-run-cache-write.unit.test.ts`,
new DB test `llm-call-cache-write.integration.test.ts`; the T5b guard test file lost its AC-PC-7 case). Still red as intended: T5/T5b repro files.

- **Config:** `LLM_PROMPT_CACHE` `off|anthropic` (default `off`), `LLM_PROMPT_CACHE_TTL` `5m|1h` (default `5m`), documented in `.env.example`.
- **Breakpoints — one place:** `infra/ai/context/cache-breakpoints.ts` `applyCacheBreakpoints(messages, currentCount, ttl)`, called by the agent
  node right after `assembleContext` only when the flag is `anthropic` (the assembler stays pure / config-free). With `off` nothing is
  converted: the request is byte-identical to T3. Copies, never mutates the checkpointed history. Breakpoint 1 = last part of the (string →
  one text part) system message; breakpoint 2 = last content part of the last history message, falling back to the nearest earlier history
  message with text when the last is a tool-calls-only AIMessage (ToolMessage allowed, T1). Empty history (or D-D floor) → only breakpoint 1.
  `5m` sends `{type:'ephemeral'}` (no `ttl` key), `1h` sends `ttl:'1h'`.
- **Raw usage:** chosen route is `__includeRawResponse: true` in `model.factory.ts` (LangChain puts the provider response on
  `additional_kwargs.__raw_response`; a fetch wrapper would have had no per-call correlation to `llmRunId`). `usage.ts`
  `ExtractedUsage.cacheWriteTokens` reads `prompt_tokens_details.cache_write_tokens` from it (absent/malformed/negative → null, never throws);
  `LLMLogHandler` → `RecordLlmCallResponse.usage.cacheWriteTokens` → `llm_calls.cache_write_tokens`; `RunMetricsCollector.onEnd(…, cacheWrite)`
  → `snapshot().tokensCacheWrite` → `ConversationRunRecord.tokensCacheWrite` (commit node, run adapter) → `conversation_runs.tokens_cache_write`.
  The raw response is stripped from the AIMessage in the agent node right after the handlers ran (`stripRawResponse`), so it is never
  checkpointed; the `LLM response` info log now also carries `cacheWriteTokens`.
- **Fix to T3 code found on the way:** `withPostToolNudge` searched the whole array for the last ToolMessage, so an empty-reply retry after a
  plain answer could append the nudge to an OLD ToolMessage inside the cached history. It now looks only at this run's messages (after the
  current HumanMessage); otherwise the last message.
- Interface deviation from T2: none (test helper `request-capture.ts` now sets `__includeRawResponse: true` like the factory).

## Out of scope

Smaller training tool set and shorter schemas; BUG-050 estimator; the post-tool second call itself; caching on
the Z.AI / Gemini routes; summariser and course-check calls (Haiku 4.5 minimum 4 096 tokens).
