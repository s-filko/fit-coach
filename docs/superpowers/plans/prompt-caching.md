# Prompt Caching (BUG-051) — Stable Prefix, Two Breakpoints, No Mid-Workout Rewrites Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and superpowers:test-driven-development. Red tests
> first in every task. Execute only the dispatched task.

- Status: planned
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

## Out of scope

Smaller training tool set and shorter schemas; BUG-050 estimator; the post-tool second call itself; caching on
the Z.AI / Gemini routes; summariser and course-check calls (Haiku 4.5 minimum 4 096 tokens).
