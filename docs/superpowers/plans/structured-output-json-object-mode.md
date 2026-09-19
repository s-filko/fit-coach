# Structured Output — Provider Mode `json_object` for the Z.AI Route Implementation Plan

- Status: done
- Branch: plan/structured-output-json-object-mode
- After: structured-output-fenced-json
- Review: 2026-09-19 | clean | R1,R2,R3,R4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. One plan task per worker session; stop after the task.

**Goal:** Make `LlmGateway.structured()` produce schema-valid output on providers that do not
support `response_format: json_schema` — concretely the dev route (GLM via the Z.AI
OpenAI-compatible endpoint) — by selecting the structured-output mode per provider through
configuration, so episode summaries and P6 user facts are actually produced on dev.

**Why (evidence, 2026-09-19):** after `structured-output-fenced-json` (BUG-017) was deployed, the
dev smoke still produced no summary: the summariser's answer held no JSON at all
(`ZodError … expected object, received undefined`). A local probe of the exact summariser call
showed GLM answering in a pseudo-YAML shape (`topics: [...]`, `facts: [...]`) — it follows the
prompt's field list literally and **ignores `json_schema`**. The provider docs confirm it: the Z.AI
Chat Completion API accepts `response_format` types `text` and `json_object` only, `tool_choice`
`auto` only, and recommends `json_object` with the schema described in the system prompt plus
client-side validation (https://docs.z.ai/guides/capabilities/struct-output,
https://docs.z.ai/api-reference/llm/chat-completion). Probes of that recipe with the real
summariser prompt: **4/4 schema-valid** (lumbar-hernia episode → `physical_constraint` /
`lower_back` + `equipment`; small-talk episode → `facts: []`; a session-numbers episode →
`facts: []`), 5–9 s per call. The Z.AI Anthropic-compatible endpoint was probed too: forced
`tool_choice` returns schema-exact tool input, but `output_config.format` is ignored the same way;
switching `structured()` to a second protocol/client was rejected by the owner in favour of this
smaller change. Prod (OpenRouter → Gemini) enforces `json_schema` and keeps it.

**Architecture:** one configuration value selects the mode for the whole LLM route:
`LLM_STRUCTURED_OUTPUT_MODE` = `json_schema` (default — today's behaviour, byte-identical) or
`json_object`. In `json_object` mode `structured()` sends `response_format: { type: 'json_object' }`
and appends one system message stating that the answer must be a single JSON object conforming
to the JSON Schema that follows (the schema serialised from the same Zod schema); parsing,
fenced-JSON recovery, Zod validation and the single retry are the existing BUG-017 code, unchanged.
Callers and prompts do not change.

**Spec:** ADR-0013 §7 (gateway; its 2026-09-19 BUG-017 amendment), BR-LLM-004, BUG-017,
`docs/superpowers/plans/refactor-p6-facts-and-progress-blocks.md` (AC-1361).

**Acceptance criteria:**
- With the mode unset (or `json_schema`) the outgoing request is byte-identical to today's (the
  existing wire-format test keeps passing unchanged).
- With `json_object`, the request carries `response_format: { type: 'json_object' }` and exactly
  one extra trailing system message containing the JSON Schema; a clean JSON answer returns with
  one provider call; the existing recovery/retry contract holds.
- An invalid mode value fails config validation at startup with a clear message.
- Dev smoke (orchestrator, after the owner sets `LLM_STRUCTURED_OUTPUT_MODE=json_object` in
  `.env.dev`): a compaction produces a `conversation_summaries` row and a `user_facts` row.

## Global Constraints

- No model-backed evals (`RUN_LLM_EVALS`, `EVALS_FULL_RUN` banned). Mocked/stubbed providers only.
- L0 stays 96/96; frozen tool output format untouched.
- New env var goes into `apps/server/.env.example` only (documented, optional, with its default —
  follow the file's existing "documented exception to no defaults in code" pattern). **Never
  write any `.env` file** — the owner applies it.
- Reserved to the orchestrator: push, ssh, deploy, `npm run db:*`, `docker compose`, merge,
  branch/worktree deletion, durable specs (`docs/adr/**`, `docs/domain/**`, `docs/features/**`,
  `API_SPEC.md`, `ARCHITECTURE.md`, `LLM_CORE_REFACTOR_PLAN.md`), `docs/STATE.md`, any `Status:`.

---

### Task 1: Configurable structured-output mode in the gateway

**Files:**
- Modify: `apps/server/src/config/index.ts` (or the LLM config module the gateway already reads —
  follow the existing pattern for optional LLM settings) — `LLM_STRUCTURED_OUTPUT_MODE`,
  enum `json_schema | json_object`, default `json_schema`, with a config unit test.
- Modify: `apps/server/src/infra/ai/llm.gateway.ts` `structured()` and
  `apps/server/src/infra/ai/structured-json.ts` (a builder for the schema instruction text, next to
  `buildJsonSchemaResponseFormat`).
- Modify: `apps/server/src/infra/ai/__tests__/llm.gateway.unit.test.ts`,
  `apps/server/src/infra/ai/__tests__/structured-json.unit.test.ts`.
- Modify: `apps/server/.env.example`.

- [x] **Step 1: Tests first** — (a) default mode: request body byte-identical to today (existing
  wire test untouched and green); (b) `json_object`: request body has
  `response_format: { type: 'json_object' }` (plain string type) and the last message is a system
  message containing the serialised JSON Schema; clean JSON answer → one provider call, no warn;
  (c) `json_object` + fenced answer → recovered, one call (recovery path unchanged); (d)
  `json_object` + schema-invalid answer → one retry then throw; (e) config rejects an unknown mode.
- [x] **Step 2: Implement.**
- [x] **Step 3: Commit** — `feat(ai): LLM_STRUCTURED_OUTPUT_MODE — json_object mode with the schema in the prompt for providers without json_schema (Z.AI)`
- [x] **Step 4: STOP** for orchestrator review. **Reviewed and accepted 2026-09-19** (commit `407ee0eb`, GLM worker via Orca). Orchestrator re-ran from `apps/server/`: `npx jest --ci src/infra/ai src/config` → `Test Suites: 58 passed, 58 total` / `Tests: 432 passed, 432 total`; `npm run evals -- --level L0` → `L0: 96/96 checks passed, 0 failed`; the worker reported `npm run test:unit` 785/785, format and type-check clean, pre-commit green. **Deviation authorised by the orchestrator mid-task:** the AC-1311 guard (`legacy-path-retired.unit.test.ts`) banned the literal `json_object` in `src` as retired `LLMService` JSON-mode vocabulary; it now allows it only in the three files that carry the new mode (gateway, `structured-json.ts`, config) — `jsonMode` / `LLMService` stay banned everywhere, and a fixture assertion proves `json_object` anywhere else still fails. `loadConfig()` per `structured()` call follows `model.factory.ts`'s existing pattern.

**Verification:** `npx jest --ci src/infra/ai src/config` → all pass; `npm run test:unit` → green;
`npm run evals -- --level L0` → 96/96; `npm run format:check`, `npm run type-check` → clean.

---

### Task 2: Close-out, deploy, dev smoke (orchestrator)

- [x] **Step 1:** Owner sets `LLM_STRUCTURED_OUTPUT_MODE=json_object` in
  `/srv/docker/fitcoach/.env.dev` (prod untouched).
- [x] **Step 2:** `close-out-review`; ADR-0013 §7 note on the mode (owner approval); BUG-017
  live confirmation; `- Status: done`; `state.mjs --write`; merge, push, deploy, health 200.
- [x] **Step 3: Dev smoke — 3 calls**, direct to the server (not through the 90 s NPM proxy): a
  phase transition, then a turn that compacts, then one more turn. Paste the
  `conversation_summaries` row, `SELECT category, fact, muscle_group, confirmations FROM
  user_facts`, and `budget_report->'longTerm'` > 0 on the last run.

---

## Review

Close-out review 2026-09-19, four zones in parallel (Sonnet subagents), diff `44a2087d...HEAD`.

**First pass: blocked — two findings, both R2, both test code.**

- **blocking | R2** | `apps/server/src/infra/ai/__tests__/llm.gateway.unit.test.ts:169-176` | DRY
  (`CONTRIBUTING_AI.md`) — the new describe's `beforeEach` copied the outer reset verbatim.
- **blocking | R2** | `apps/server/src/config/__tests__/structured-output-mode.unit.test.ts:3-16` and
  `episode-tunables.unit.test.ts:3-16` | DRY — byte-identical `BASE` env fixture.

Both **closed** in `79ac9499` (GLM worker via Orca): one `resetGatewayMocks` helper, one
`src/config/__tests__/base-env.fixture.ts`; test count unchanged (432), L0 96/96. R2 re-run: clean.
R1 and R3 found nothing blocking; R3 proved the AC-1311 guard end to end by dropping a real
offender file into `src/infra/ai/` and watching the guard fail. **Verdict: clean.**

**Advisory findings and where they went:** R4 — BUG-017 marked Fixed before any live confirmation
→ corrected in `ed80dd13` (Fixed only once a dev smoke produces the rows); R4 — ADR-0013 §7 silent on
the mode, and R3 — AC-1311's grep wording now literally false → both amended in `ed80dd13` with the
owner's approval. No backlog entries.

**Meta findings → `docs/REVIEW_FINDINGS.md`:** R1 — ADR currency vs. R1's zone (raises the existing
R1/R4 mechanism-drift blind spot); R2 — test-fixture DRY scope (raises the existing rule
candidate); R3 — a plan outside the `AC-13xx` series should mint its own AC ids (raises the existing
"plan with no AC ids" blind spot); R4 — `BUGS.md`'s own header rule cannot be cited as blocking
(new rule candidate).

## Dev smoke (2026-09-19, after deploy `21d5e2a6`)

The owner set `LLM_STRUCTURED_OUTPUT_MODE=json_object` in `.env.dev`; the orchestrator recreated
`fitcoach-dev-server` (compose `up -d server`, as `deploy.sh` does) and confirmed the value inside
the container. Calls went straight to the server (`172.21.0.3:3000`), not through the 90 s NPM
proxy. **Five calls, not three**: episodes shorter than two turns are trimmed without a summary by
design (D-B), and the phase transition in call 1 compacted a one-turn episode — so the injury had
to be restated and the episode grown to three turns before the transition that mattered.

| # | Message (smoke user `358bedb4…`) | Result |
|---|---|---|
| 1 | restates the lumbar hernia | 200, 44 s; gap compaction of a 1-turn chat episode → trimmed (D-B); model moved chat → plan_creation |
| 2 | Mon/Wed/Fri, home, dumbbells ≤ 20 kg + bench | 200, 149 s; transition compaction → 1-turn episode trimmed (D-B); plan proposed |
| 3 | restates the hernia, asks if the plan respects it | 200, 69 s; plan revised (bent-over row → chest-supported row, plank removed) |
| 4 | "let's postpone the plan, just talk" | 200, 14 s; plan_creation → chat |
| 5 | "which core exercises are safe for my back?" | 200, 49 s; **compaction with a summary** |

Evidence from call 5: gateway log `profile: "summarizer"`, `latencyMs: 14141`, no retry and no
recovery warning; `conversation_summaries` — 1 row (15:26:47); `user_facts`:

```
      category       |                                   fact                                    | muscle_group | confirmations
---------------------+---------------------------------------------------------------------------+--------------+---------------
 equipment           | Trains at home with dumbbells up to 20 kg and a bench                     |              | 1
 schedule_constraint | Trains Monday, Wednesday, Friday                                          |              | 1
 physical_constraint | Lumbar hernia; doctor forbids any lower back loading — no deadlifts, ... | lower_back   | 1
 coaching_preference | Primary training goal is muscle mass gain                                 |              | 1
```

and the same run's `budget_report->'longTerm'` = **99** (the `## User Facts` block reached the
prompt). BUG-017 is fixed; AC-1361's extraction and block halves are now seen live on dev (its
pass-rate half stays deferred to the consolidated eval pass). The live hard-validation path
(a conflicting exercise rejected by `save_workout_plan`/`start_training_session`) was not driven
in this smoke — it is pinned by the unit tests and the mocked scenario test.

