# Chat Continuity — Compaction Keeps the Recent Conversation, the Reply Answers the Latest Message Implementation Plan

- Status: planned
- Branch: plan/chat-continuity
- After: structured-output-json-object-mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. One plan task per worker session; stop after the task.

**Goal (owner, 2026-09-20):** the bot must behave like a chat — answer the message the user just
sent, like a person would; compaction only helps it remember older things. Concretely: no message
is ever dropped without being summarised, the recent conversation is always seen verbatim, the
model can tell that time has passed, and everything the model says to the user is delivered.

**Evidence (BUG-018, dev, owner's Telegram account, 2026-09-19 16:27 UTC):** the owner sent
"привет" after a 6 h gap. (1) `compact` treated the gap as an episode end and removed **all**
history (`planCompaction` returns `kept: []` for `inactivity`/`transition`); the ended episode had
one turn, so D-B trimmed it **without a summary** — the model lost that conversation entirely.
(2) The model answered "Hi filko! 👋 Good to see you back… quick recap before we lock it in" **and**
called `search_exercises` 13 times in the same step; its final message after the tools was a plan
dump. The adapter returns only the last AI message (`conversation-run.adapter.ts:115`,
`lastAiText`), so the greeting never reached Telegram — the owner saw a plan instead of a reply.

**Industry standard this plan follows (no custom machinery):** LangChain/LangMem summarisation —
when history is compacted, the oldest messages are folded into a summary and the remaining
messages are kept verbatim ("summary + remaining messages"); nothing is dropped without being
summarised (https://langchain-ai.github.io/langmem/guides/summarization/,
https://docs.langchain.com/oss/python/langchain/short-term-memory).

**Owner decisions this plan changes (approved 2026-09-20, ADR-0013 §3.3 amendment at close-out):**
the 2026-09-17 memory-model rule "an episode ends by gap/transition/budget and is replaced by its
summary; trivially short episodes are trimmed without a summary" becomes: compaction at any trigger
summarises only what lies **beyond a verbatim tail of the last `EPISODE_KEEP_TURNS` turns**, and a
part too short to summarise is **kept**, never dropped. Fact extraction stays at summarisation
(unchanged). Phase transitions and the inactivity gap remain compaction triggers.

**Architecture:**
- `planCompaction` (`graph/nodes/compact.ts`) — every trigger keeps the last `K` whole turns
  (`EPISODE_KEEP_TURNS`, default 6, a documented tunable like the other `EPISODE_*`); `removed` is
  only what precedes that tail. If `removed` is short by D-B's measure (`isShortEpisode`), nothing
  is removed this run (it rides along until a later compaction can summarise it). The budget
  trigger keeps its existing token-driven loop but never cuts into the `K`-turn tail unless the
  tail alone exceeds the history budget (then oldest-first, as today).
- A time-gap note: when the current user message arrives more than `EPISODE_GAP_HOURS` after the
  previous message, the assembler places one short system note right before it — e.g. "The user
  returns after 14 h. Reply to their new message first; the earlier conversation is context, not
  an agenda." It is a versioned prompt module under `prompts/blocks/` (no inline prompt text).
- Delivery: the reply is every non-empty assistant text produced **in this run**, in order, joined
  with a blank line — not only the last one. Earlier runs' texts are never re-sent.

**Spec:** ADR-0013 §3.3 (compaction), §3.4 (assembly order), D-B (short episodes), BR-LLM-001
(inactivity gap), BR-LLM-004; `docs/BUGS.md` BUG-018.

**Acceptance criteria (this plan mints its own ids):**
- **AC-CC-1** — after an inactivity gap or a phase transition, the last `K` turns are still in the
  model input verbatim; older messages are either summarised or (if too short) kept; no message is
  removed without a summary.
- **AC-CC-2** — when the gap exceeds `EPISODE_GAP_HOURS`, the model input carries the gap note
  immediately before the current user message; with no gap there is no note.
- **AC-CC-3** — the reply delivered to the client contains every non-empty assistant text of the
  current run in order (text written alongside tool calls included), and nothing from earlier runs.
- **AC-CC-4** — the reproduction test (Task 0) exists before any fix, reproduces the owner's case
  and fails today on all three points; each fix task turns its own point green.
- **AC-CC-5** — dev smoke through the owner's Telegram bot: after a gap, "привет" gets a reply
  that answers the greeting.

## Global Constraints

- No model-backed evals (`RUN_LLM_EVALS`, `EVALS_FULL_RUN` banned). Mocked models only.
- L0 stays green. The gap note and the tail change assembled inputs: any L0 / message-assembly
  snapshot that moves must be listed and explained in the task's STOP report (expected: only
  fixtures with a gap or a compaction); frozen tool output format untouched.
- New env var `EPISODE_KEEP_TURNS` goes into `apps/server/.env.example` only. Never write `.env`.
- Reserved to the orchestrator: push, ssh, deploy, `npm run db:*`, `docker compose`, merge,
  branch/worktree deletion, durable specs (`docs/adr/**`, `docs/domain/**`, `docs/features/**`,
  `API_SPEC.md`, `ARCHITECTURE.md`, `LLM_CORE_REFACTOR_PLAN.md`), `docs/STATE.md`, `docs/BUGS.md`,
  any `Status:`.

**Order (owner, 2026-09-20): no fix before the reproduction.** Task 0 lands first; Tasks 1–3 each
flip one of its `test.failing` cases to `test`, and may not start until Task 0 is accepted.

---

### Task 0: Reproduction — the owner's "привет" after a pause (AC-CC-4)

**Files:** `apps/server/src/infra/ai/graph/__tests__/chat-continuity.repro.unit.test.ts` (reuse
`graph-test-support.ts` and the scripted-model pattern of `user-facts.scenario.unit.test.ts`; the
model is mocked beneath the real `OpenAiLlmGateway`). Test code only — no production change.

The scenario mirrors BUG-018's evidence:
1. Prior state: one stored episode summary whose `openItems` say the plan is ready and pending save
   (the agenda the model later pushed), and a **one-turn** conversation in `plan_creation` (the
   10:23 exchange: user "привет", assistant greeting).
2. A controlled clock advances **6 h** (> `EPISODE_GAP_HOURS`); the user sends "привет".
3. The scripted model answers in two steps: first an AI message with text "Hi! Good to see you
   back." **and** `search_exercises` tool calls; after the tool results, a final text that is a plan
   dump.

Three cases, each written as the **required** behaviour and marked `test.failing` (Jest) because
today's code violates it — the file is green while the bug exists and each case turns red the
moment its fix lands, which is when the fix task flips it to `test`:
- **(a) AC-CC-1** — the model input for the new "привет" contains the 10:23 exchange verbatim.
- **(b) AC-CC-2** — the model input carries a time-gap note immediately before the new message.
- **(c) AC-CC-3** — the reply delivered by the run port contains "Hi! Good to see you back."

Plus one ordinary `test` pinning today's observable symptom (so the reproduction is visible, not
just implied): the delivered reply equals the final plan-dump text only.

- [x] **Step 1:** write the test; run it; confirm (a)–(c) fail for the stated reason (quote each
  failure message in the STOP report — a case that fails for another reason is not a reproduction).
- [x] **Step 2: Commit** — `test(ai): reproduce BUG-018 — greeting after a pause is not answered (AC-CC-4)`
- [x] **Step 3: STOP** for orchestrator review. **Reviewed and accepted 2026-09-20** (commit `69d7bd19`, GLM worker via Orca; orchestrator re-ran the file: 4/4, the three cases reported as expected failures). Each case was flipped to `test` by the worker and failed for the stated reason: (a) the model input held no AI message at all; (b) the message before "привет" was the `=== CLIENT PROFILE ===` domain block, not a gap note; (c) the delivered text was the plan dump. Logs in the run confirm the mechanism: the 2-turn episode was summarised, the 1-turn one "trimmed without a summary (D-B)", history 0. **Fixes wait (owner, 2026-09-20)** until `training-journey-scenarios` Tasks 1–3 (DB-backed journey A) are accepted.

**Verification:** `npx jest --ci src/infra/ai/graph/__tests__/chat-continuity.repro.unit.test.ts`
→ passes (with the three `failing` cases); `npm run test:unit` → green.

---

### Task 1: Compaction keeps a verbatim tail and never drops unsummarised messages (AC-CC-1)

**Files:** `apps/server/src/infra/ai/graph/nodes/compact.ts` (`planCompaction`, `isShortEpisode`
use), `apps/server/src/infra/ai/graph/nodes/compact.node.ts`, `apps/server/src/config/index.ts`
(`EPISODE_KEEP_TURNS`), their tests, `apps/server/.env.example`.

- [x] **Step 1: Tests first** — inactivity and transition keep the last `K` turns and remove only
  the older part; a short older part → nothing removed, no summariser call; a long older part →
  summarised (and facts extracted as today) while the tail stays; budget trigger unchanged except
  it respects the tail; a turn is never split (a tool call and its result stay together).
- [x] **Step 2: Implement.**
- [x] **Step 2b:** flip Task 0's case (a) from `test.failing` to `test`; it must pass.
- [x] **Step 3: Commit** — `fix(ai): compaction keeps the last turns verbatim and never drops unsummarised messages (BUG-018, AC-CC-1)`
- [ ] **Step 4: STOP** for orchestrator review.

**Verification:** `npx jest --ci src/infra/ai/graph src/config` → pass; `npm run test:unit` →
green; `npm run evals -- --level L0` → green (list any moved snapshot); format + type-check clean.

---

### Task 2: The time-gap note before the current message (AC-CC-2)

**Files:** a new block `apps/server/src/infra/ai/prompts/blocks/time-gap.v1.ts` (+ index export),
`apps/server/src/infra/ai/context/assemble-context.ts` (placement right before the current user
message; the gap is computed from the previous message's time — the graph already tracks
`lastUserMessageAt` in state), tests, snapshot updates if any.

- [ ] **Step 1: Tests first** — gap > `EPISODE_GAP_HOURS` → the note (with a human-readable
  duration) sits immediately before the current message; no gap → no note; first message ever →
  no note.
- [ ] **Step 2: Implement.**
- [ ] **Step 2b:** flip Task 0's case (b) to `test`; it must pass.
- [ ] **Step 3: Commit** — `feat(ai): time-gap note before the user's new message after a pause (BUG-018, AC-CC-2)`
- [ ] **Step 4: STOP** for orchestrator review.

**Verification:** as Task 1, plus `npx jest --ci evals/levels/__tests__/no-inline-prompts.unit.test.ts`.

---

### Task 3: The reply carries everything the model said in this run (AC-CC-3)

**Files:** `apps/server/src/infra/ai/graph/conversation-run.adapter.ts` (replace `lastAiText` for the
reply), `apps/server/src/infra/ai/graph/episode.ts` (a helper next to `lastAiText`), tests.

- [ ] **Step 1: Tests first** — run with text + tool calls + final text → both texts, in order,
  blank line between; tool-only AI messages contribute nothing; texts from earlier runs never
  included; single-message runs unchanged byte for byte.
- [ ] **Step 2: Implement.**
- [ ] **Step 2b:** flip Task 0's case (c) to `test`; it must pass, and the pinned-symptom test is deleted (it now fails by design).
- [ ] **Step 3: Commit** — `fix(ai): the reply includes assistant text written alongside tool calls in this run (BUG-018, AC-CC-3)`
- [ ] **Step 4: STOP** for orchestrator review.

**Verification:** `npx jest --ci src/infra/ai` → pass; `npm run test:unit` → green; L0 green.

---

### Task 5: Close-out, deploy, smoke (orchestrator)

- [ ] `close-out-review`; ADR-0013 §3.3 amendment — **text approved by the owner 2026-09-20:** "Compaction at any trigger (inactivity gap, phase transition, budget) summarises only messages older than the last `EPISODE_KEEP_TURNS` turns (default 6), which stay verbatim; a part too short to summarise is kept, never dropped (supersedes D-B's trim-without-summary). After a gap longer than `EPISODE_GAP_HOURS` a time-gap note precedes the new user message. The user receives every assistant text of the run. The standard summarise-older / keep-recent pattern.";  BUG-018 status;
  `- Status: done`; `state.mjs --write`; merge, push, deploy, health 200.
- [ ] Smoke: one API call on the smoke user after a gap, and **the owner's own Telegram "привет"**
  (AC-CC-5) — the reply must answer the greeting.
