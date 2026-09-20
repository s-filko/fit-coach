# Reply Latency and Live Typing (BUG-019) Implementation Plan

- Status: planned
- Branch: plan/reply-latency-and-typing
- After: chat-continuity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. One plan task per worker session; stop after the task.

**Goal (owner, 2026-09-20):** answers must not take minutes, and while one is being produced the bot
must visibly keep typing. BUG-019 has the evidence: a 189 s run whose first model call spent 129 s
reasoning into a 4096-token cap and returned empty text, after which the code silently re-ran the
whole call. Meanwhile the bot sends the Telegram "typing" action once, so after ~5 s the chat looks dead.

**Findings this plan builds on (verified 2026-09-20):**
- Z.AI docs: GLM-5.3 always reasons; depth is `reasoning_effort` = `low` | `high` | `max`;
  `thinking: {type:"disabled"}` is refused for 5.3 (5.2 still supports it). Reasoning tokens spend the
  output budget; `finish_reason` can be `stop | tool_calls | length | sensitive | ...`.
- Probes (5 calls): `reasoning_effort=low` roughly halves per-call latency (13.7 → 9.5 s short;
  8.8 → 5.0 s with tools) and reduced tool calls 5 → 3 in the plan-creation shape.
- `model.factory.ts:27` hard-codes `maxTokens: 4096` for every profile; `config.LLM_PROFILES`
  already supports per-profile `model`/`temperature`/`maxTokens` overrides (`config/llm-profiles.ts`).
- `agent.node.ts:165-176` retries the whole call once on an empty response, then falls back to the
  `empty_reply` catalog text. Nothing records `finish_reason` or reasoning-token counts.
- `apps/bot` sends one `sendChatAction('typing')` per incoming message (one-shot).

**Acceptance criteria:**
- **AC-RL-1** — the output-token cap and the reasoning depth are configuration, not constants:
  `LLM_MAX_TOKENS` (default 16384) and `LLM_REASONING_EFFORT` (default `low`, sent only when set),
  both overridable per profile; `.env.example` documents them; unit tests pin that the built
  `ChatOpenAI` carries them.
- **AC-RL-2** — a truncated answer is visible and is not re-run blindly: every model response logs
  `finish_reason` and completion tokens at info; on `length` the code logs a warn naming it and does
  **not** repeat the identical call (the existing one-shot retry stays only for a genuinely empty
  `stop` answer), and the user gets the catalog fallback rather than a second multi-minute wait.
- **AC-RL-3** — while a reply is being produced, the bot re-sends the Telegram typing action every
  5–6 s (owner: a ~1 s gap between pulses reads as natural) until the reply, an error or a hard
  ceiling; the loop always stops (no timer leaks), covered by tests with fake timers.

## Global Constraints

- No model-backed evals (`RUN_LLM_EVALS` / `EVALS_FULL_RUN` never set); mocked models only.
- Never write any `.env*` file — `.env.example` only.
- Reserved to the orchestrator: push, ssh, deploy, merge, `npm run db:*`, `docker compose`, durable
  specs (`docs/adr/**`, `docs/domain/**`, `ARCHITECTURE.md`, `API_SPEC.md`, `LLM_CORE_REFACTOR_PLAN.md`),
  `docs/STATE.md`, `docs/BUGS.md`, any `Status:`.
- Model choice stays GLM-5.3 (`reasoning_effort=low`). GLM-5.2 with reasoning off is the fallback the
  owner may pick after the dev smoke — do not switch models in this plan.

---

### Task 1: Output cap and reasoning depth become configuration (AC-RL-1)

**Files:** `apps/server/src/config/index.ts` (`LLM_MAX_TOKENS`, `LLM_REASONING_EFFORT`),
`apps/server/src/config/llm-profiles.ts` (per-profile overrides), `apps/server/src/infra/ai/model.factory.ts`,
`apps/server/.env.example`, their tests.

- [x] **Step 1: Tests first** — the factory passes `maxTokens` from config (default 16384) and, when
  `LLM_REASONING_EFFORT` is set, a `reasoning_effort` model kwarg; unset → the field is absent from the
  request; a profile override wins over the global value.
- [x] **Step 2: Implement.** `reasoning_effort` is an OpenAI-compatible extra: pass it via the
  ChatOpenAI `modelKwargs` (verify the built request body in the test, not just the field).
- [x] **Step 3: Commit** — `feat(ai): output cap and reasoning depth are configuration (BUG-019, AC-RL-1)`
- [x] **Step 4: STOP** for orchestrator review.

**Verification:** `npx jest --ci src/infra/ai src/config` → pass; `npm run test:unit` → green;
`npm run evals -- --level L0` → green; format + type-check clean.

---

### Task 2: Truncation is visible and never silently repeated (AC-RL-2)

**Files:** `apps/server/src/infra/ai/llm-log-handler.ts` (or the gateway — whichever sees
`response_metadata.finish_reason`), `apps/server/src/infra/ai/graph/nodes/agent.node.ts`, their tests.

- [ ] **Step 1: Tests first** — a `length` response logs a warn naming the truncation and does NOT
  trigger the identical retry (the user gets the `empty_reply` catalog text); an empty `stop`
  response still retries once as today; a normal response logs `finish_reason` + completion tokens at info.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `fix(ai): truncated answers are logged, not blindly re-run (BUG-019, AC-RL-2)`
- [ ] **Step 4: STOP** for orchestrator review.

**Verification:** `npx jest --ci src/infra/ai` → pass; `npm run test:unit` → green; L0 green;
format + type-check clean.

---

### Task 3: The bot keeps typing while the answer is produced (AC-RL-3)

**Files:** `apps/bot/` — the message handler plus a small `typing-keepalive.ts` helper, its tests
(`apps/bot` has a jest harness since P5).

- [ ] **Step 1: Tests first** (fake timers) — the helper pulses `sendChatAction('typing')` immediately
  and then every 5–6 s while the request is in flight; it stops on success, on error and at a ceiling
  (use the server's `requestTimeout`, 420 s, as the cap); a failing `sendChatAction` never breaks the
  reply path; no timer survives the call.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `feat(bot): keep the typing indicator alive while the reply is produced (BUG-019, AC-RL-3)`
- [ ] **Step 4: STOP** for orchestrator review.

**Verification:** `npx jest --ci` in `apps/bot` → pass; `npm run test:unit` in `apps/server` → green;
format + type-check clean in both.

---

### Task 4: Close-out (orchestrator)

- [ ] One combined close-out review; `- Status: done`; `state.mjs --write`; merge, push, deploy dev, health 200.
- [ ] Dev smoke by the owner: a plan-creation exchange in Telegram — the typing indicator stays alive
  and the reply arrives materially faster than the 189 s run in BUG-019. Record the new `latency_ms`
  from `conversation_runs`. If it is still too slow, the owner decides on GLM-5.2 with reasoning off.
