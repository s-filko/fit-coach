# Cache Accounting — Cached/Reasoning Tokens per Call and Cache-Miss Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. Red tests first, then the fix.

- Status: done
- Branch: plan/cache-accounting
- Review: 2026-09-26 | clean | R1,R2,R3,R4

**Goal:** make prompt-cache use visible, as the basis for the caching work in
`docs/superpowers/specs/2026-09-26-training-history-context-design.md` § 4 "First step",
items 1 and 4 (owner 2026-09-26: "1 + 4"; items 2 — `session_id` on runs — and 3 — the
cost-per-workout report — are a later step):
1. Every model call records its full provider usage — input, output, **cached input**,
   reasoning tokens — on `llm_calls`, rolled up per run on `conversation_runs`.
2. Every call gets an **expected cache state** from comparing its request with the same user's
   previous call, so a miss caused by the TTL (everything else right) is distinguishable from a
   changed prefix, and a miss where the cache should have hit is visible as *unexplained*.

## Verified facts (2026-09-26)

- **Z.AI usage shape (probe, 2 calls, `glm-5.3-flash`, same ~5.7k prefix):**
  `{"prompt_tokens":5765,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens":30,
  "completion_tokens_details":{"reasoning_tokens":30}}`, then `cached_tokens: 5760` on the second
  call. Implicit caching works immediately; no cost field is returned.
- **Z.AI docs** (`docs.z.ai/guides/capabilities/cache`): implicit caching, reported in
  `usage.prompt_tokens_details.cached_tokens`; **no TTL and no minimum prefix size are stated**
  ("reasonable time limits"). Cached tokens are billed at a discount (usually 50 %); the effect on
  the coding-subscription quota is not documented.
- **OpenRouter → Gemini** (`openrouter.ai/docs/features/prompt-caching`): implicit caching on
  Gemini 2.5+; minimum 1 024 tokens (2.5 Flash) / 4 096 (2.5 Pro); TTL "on average 3–5 minutes".
  Nothing is stated for Gemini 3.x. Prod is frozen — informative only.
- **`@langchain/openai` 1.2.9** already maps the fields onto `AIMessage.usage_metadata`:
  `input_token_details.cache_read` and `output_token_details.reasoning`
  (`node_modules/@langchain/openai/dist/chat_models/completions.js:111-117,192-196`).
  `llmOutput.tokenUsage` — the only thing read today — carries prompt/completion counts only.
- **Readers today:** `run-metrics.ts:116-122` (`LlmMetricsHandler.handleLLMEnd`),
  `llm-log-handler.ts:241-275` (`handleLLMEnd` → `response.usage`), `agent.node.ts:66-87`
  (`tokenUsageOf`, the `LLM response` INFO line), `transcript-formatter.ts:107`.
  `llm_calls.response.usage` stores `{promptTokens, completionTokens}` (the spec's "reply text
  only" is imprecise: usage is there, the cache is not).
- `llm_calls` has **no `user_id`** — only `run_id` (the `conversation_runs` row is written at
  commit, after the calls). `userId` is available in the callback metadata
  (`conversation-run.adapter.ts:144,222`; `llm-log-handler.ts` already reads it).
- **Context order** (`assemble-context.ts:166-175`): system prompt (block 1, ends with the `NOW`
  line) → user facts → directive → summaries → domain blocks → history → gap note. Everything
  after `NOW` is therefore never cached today — the attribution below should show exactly that.

## Decisions (D)

- **D1 — columns.** `llm_calls` gains: `user_id uuid` (nullable, no FK — same reason as `run_id`;
  from callback metadata), `input_tokens`, `output_tokens`, `cache_read_tokens`,
  `reasoning_tokens` (nullable ints), `cache_expected text`, `cache_diverged_at text`,
  `cache_shared_prefix_tokens integer`, `cache_gap_ms integer`; index `(user_id, created_at)`.
  `conversation_runs` gains `tokens_cached`, `tokens_reasoning` (nullable ints). One migration
  via `npm run drizzle:generate`. `response.usage` JSON keeps its shape plus the two new fields.
- **D2 — source of truth for usage:** `generation.message.usage_metadata` (input/output,
  `input_token_details.cache_read`, `output_token_details.reasoning`); fallback to
  `llmOutput.tokenUsage` for input/output only. A field the provider did not report is stored
  as **null, never 0** (0 cached means "reported, none hit"). One shared extractor
  (`infra/ai/usage.ts`) used by all four readers — no copies; `agent.node.ts`'s `tokenUsageOf`
  is replaced by it, and the `LLM response` INFO line adds `cacheReadTokens`, `reasoningTokens`.
- **D3 — comparison base:** the previous `llm_calls` row of the **same user and same model**, by
  `created_at` (any run — the cache does not care about run boundaries). Same model because the
  compaction/course-check calls use other prefixes only rarely and a model switch is always a
  cold cache.
- **D4 — prefix comparison** (at record time, in the recorder; one extra SELECT of the previous
  row plus the `prompt_blobs` content of its system hashes). Order: tools + `response_format`
  (compared as serialized JSON; any difference → `tools`), then messages in order — system
  messages by hash, others by serialized equality. At the first differing message, the common
  **character** prefix of the two contents is computed. `cache_diverged_at` =
  `<label>#<messageIndex>@<charOffset>`; labels: `tools`, `system:<part>` where `<part>` is the
  assemble-context part (`prompt`, `facts`, `directive`, `summaries`, `domain`, `gap-note` —
  derived from the part's stable header/position; fallback `system[i]`), `history[i]:<role>`.
  `cache_shared_prefix_tokens` = `round(input_tokens × sharedChars / totalChars)` of the current
  request (an estimate — tokenizer-free, stated as such in the column comment).
- **D5 — expected states** (`cache_expected`):
  `cold` (no previous call) · `unknown` (previous request already pruned) ·
  `ttl_expired` (only when a TTL is configured and `cache_gap_ms` > TTL) ·
  `too_short` (only when a minimum is configured and the shared estimate < minimum) ·
  `warm` (the previous request is a full prefix of this one — only new messages appended) ·
  `prefix_changed:<label>` (otherwise; `<label>` = the label part of `cache_diverged_at`).
  A **miss is unexplained** when `cache_expected` is `warm` or `prefix_changed:*` with a shared
  estimate ≥ the configured minimum (or > 0 when none is configured) and `cache_read_tokens = 0`.
  This is a query, not a stored column (defined once in `docs/DB_SETUP.md`, see Task 1).
- **D6 — provider limits are config, never guessed:** `LLM_CACHE_TTL_SECONDS`,
  `LLM_CACHE_MIN_PREFIX_TOKENS` — optional, **unset = unknown** (Z.AI documents neither). With
  them unset `ttl_expired`/`too_short` are never produced; `cache_gap_ms` is always stored, so
  the Z.AI TTL can be read off the data (hit vs gap) and then configured. `.env.dev` stays unset.
- **D7 — never fails a call:** attribution errors are logged and leave the cache columns null —
  the recorder's existing D-F contract.
- **D8 — executor:** one worker, Sonnet (cross-cutting: migration + callbacks + recorder logic).

## Acceptance criteria

| AC | Criterion | Verification |
|---|---|---|
| AC-CA-1 | A call whose `usage_metadata` carries `cache_read` 5760 / `reasoning` 30 is stored with `cache_read_tokens`=5760, `reasoning_tokens`=30, `input_tokens`, `output_tokens`, `user_id`; a response without details stores null (not 0) | unit (extractor) + integration (recorder, test DB) |
| AC-CA-2 | `conversation_runs.tokens_cached` / `tokens_reasoning` = the sums over the run's own calls; null when no call reported them | unit (`RunMetricsCollector`) + integration |
| AC-CA-3 | Attribution: no previous → `cold`; previous is a prefix → `warm`; changed facts block → `prefix_changed:system:facts` with the diverged offset; changed `NOW` → `prefix_changed:system:prompt` with offset at the `NOW` line; changed tools → `prefix_changed:tools`; pruned previous → `unknown`; TTL/minimum configured → `ttl_expired`/`too_short`; unset → never | integration (recorder, test DB, table-driven) |
| AC-CA-4 | An attribution failure (e.g. the previous row query throws) leaves the call recorded with null cache columns and the call succeeds | unit |
| AC-CA-5 | `docs/DB_SETUP.md` documents the new columns and one "cache efficiency" query: per user/day — calls, input, cached, cache share, counts per `cache_expected`, unexplained misses | doc review |

## Task 1 — Usage extraction, columns, attribution, docs (AC-CA-1..5)

Files: new `apps/server/src/infra/ai/usage.ts` (+ unit test); `infra/ai/run-metrics.ts`;
`infra/ai/llm-log-handler.ts` (pass `userId`, full usage); `infra/ai/llm-call-recorder.ts`
(`RecordLlmCallInput.userId`, usage fields, attribution — a separate pure function
`attributeCache(prev, current, limits)` in a new `infra/ai/cache-attribution.ts`, the recorder only
fetches `prev` and stores the result); `infra/ai/graph/nodes/agent.node.ts` (`tokenUsageOf` →
shared extractor); `infra/observability/transcript-formatter.ts` (show cached tokens);
the commit path that writes `conversation_runs` (`tokens_cached`, `tokens_reasoning`);
`infra/db/schema.ts` + generated migration; config schema (`LLM_CACHE_TTL_SECONDS`,
`LLM_CACHE_MIN_PREFIX_TOKENS`, optional); `docs/DB_SETUP.md` (columns + query);
`.env.example` if one lists LLM vars.

Verification (from `apps/server/`): `npm run check-all`; `npm run test:unit`;
`/Users/filko/orca/workspaces/fit_coach/db-test-lock.sh npm run test:integration`;
repo root `node scripts/state.mjs --check`.

## Live check (dev, after deploy)

Owner's next real messages on dev (no extra model calls from us): `llm_calls` rows show
non-null `cache_read_tokens` and a `cache_expected`; expect mostly `prefix_changed:system:prompt`
(the `NOW` line) — the baseline the history-context work will move.

## Not in scope

- `session_id` on `conversation_runs`, the cost-per-workout report, money/price tables (spec items 2, 3).
- Reordering the context for caching (spec § 4 target order) — this plan only measures.
- Backfilling old `llm_calls` rows.

## Review

2026-09-26, one combined reviewer (R1–R4, economical-work rule). First verdict: **blocked** (1 blocking);
R3 re-run after the fixes: **clean** (see "R3 re-run" below).

**Blocking**
- R3 | `cache-attribution.ts:187-196` (with `:64-73`) | AC-CA-3 — the previous request is read back
  from `jsonb`, which does not preserve object key order (sorts by length, then bytewise); the
  current request is compared in insertion order. Verified by the reviewer:
  `SELECT '{"type":"object","properties":{},"required":[],"additionalProperties":false,"$schema":"x"}'::jsonb::text`
  → keys `type, $schema, required, properties, additionalProperties`. Every call with tools is
  therefore `prefix_changed:tools` with shared 0, `warm` is unreachable in production, and history
  messages with `tool_calls` diverge falsely. Tests pass because they use single-key tool objects
  and in-memory fixtures. — *open*

**Advisory**
- R1 | `llm-call-recorder.ts:189-209` | ADR-0013 §8 item 2 — the synchronous recorder now also does
  an indexed SELECT, reads the previous `request` jsonb and its blobs; ADR's "one indexed insert"
  cost basis is no longer true.
- R1 | `llm-call-recorder.ts:115-155` | one reason to change — the previous-call lookup lives in
  the writer; belongs in a reader/attribution adapter.
- R2 | `cache-attribution.ts:54` and `tools/exercise-name-check.ts:89` | DRY — `commonPrefixLength`
  duplicated verbatim.
- R2 | `llm-call-recorder.ts:138-143` and `observability/transcript-reader.ts:218-221` | DRY — hash
  → `prompt_blobs` content resolution re-implemented.
- R2 | `cache-attribution.ts:105-116` | DRY — block headers copied as literals, not imported from
  `prompts/blocks/*`; a reworded header silently falls back to `system:domain`, no test ties them.
- R3 | `llm-call-recorder.ts:201` | D5 — `cache_gap_ms` measured to record time (after the
  response), so it includes the call's own latency (~11–13 s); should be measured from the call start.
- R3 | `cache-attribution.ts:166,214` | D4 — shared-prefix estimate distributes the ~5k tool-schema
  tokens over message characters only.
- R3 | `llm-call-recorder.integration.test.ts:292` | "identical request is warm" never asserts `warm`.
- R3 | plan AC-CA-3 | facts-block and NOW-offset cases proven by unit tests only, not through the
  recorder against the DB.
- R4 | `docs/adr/0013-llm-core-target-architecture.md:394,410-412,430` | stale column lists and cost
  statement — durable spec, escalated to the owner, not edited.
- R4 | `docs/ARCHITECTURE.md:84-90` | `infra/ai/` tree lacks `usage.ts`, `cache-attribution.ts`.

**Advisory disposition:** R1 lookup-placement → `BACKLOG.md` § cache-accounting advisories; R1
ADR cost basis + R4 ADR columns → ADR-0013 §8 amendment 2026-09-26 (owner-approved); all R2, R3
and the R4 `ARCHITECTURE.md` advisories fixed in ad9ca4e0…5399d2d7.

**R3 re-run (2026-09-26)** — blocker confirmed closed; no new defect. Advisories: (a) the claimed
multi-key-schema → `warm` DB test was missing (the worker's report overstated it) — added in 3acbda82;
(b) `canonicalStringify` rendered `undefined`-valued keys as `null` while jsonb drops them — fixed in
3acbda82 with a red-first unit test; (c) evidence for the fix commits — orchestrator re-ran at
3acbda82: `test:integration` 47 suites / 632 passed + 1 todo, `test:scenarios` 19 / 392 passed + 1 todo,
`state.mjs --check` OK (worker: `check-all` clean, `test:unit` 1456 passed).

**Meta** — filed in `docs/REVIEW_FINDINGS.md` § Blind spots (jsonb round trip).
