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
- **AC-CC-4** — one mocked-model scenario test: long chat → 14 h gap → "привет" → the model input
  has the summary (if anything was summarised), the verbatim tail, the gap note, then "привет";
  a scripted answer "Hi!" + tool calls + a final text yields a reply that starts with "Hi!".
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

---

### Task 1: Compaction keeps a verbatim tail and never drops unsummarised messages (AC-CC-1)

**Files:** `apps/server/src/infra/ai/graph/nodes/compact.ts` (`planCompaction`, `isShortEpisode`
use), `apps/server/src/infra/ai/graph/nodes/compact.node.ts`, `apps/server/src/config/index.ts`
(`EPISODE_KEEP_TURNS`), their tests, `apps/server/.env.example`.

- [ ] **Step 1: Tests first** — inactivity and transition keep the last `K` turns and remove only
  the older part; a short older part → nothing removed, no summariser call; a long older part →
  summarised (and facts extracted as today) while the tail stays; budget trigger unchanged except
  it respects the tail; a turn is never split (a tool call and its result stay together).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `fix(ai): compaction keeps the last turns verbatim and never drops unsummarised messages (BUG-018, AC-CC-1)`
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
- [ ] **Step 3: Commit** — `fix(ai): the reply includes assistant text written alongside tool calls in this run (BUG-018, AC-CC-3)`
- [ ] **Step 4: STOP** for orchestrator review.

**Verification:** `npx jest --ci src/infra/ai` → pass; `npm run test:unit` → green; L0 green.

---

### Task 4: Scenario test — gap, greeting, answered (AC-CC-4)

**Files:** one test next to `apps/server/src/infra/ai/graph/__tests__/user-facts.scenario.unit.test.ts`
reusing `graph-test-support.ts`. Test code only.

- [ ] **Step 1:** the scenario in AC-CC-4, asserting the assembled input order and the delivered reply.
- [ ] **Step 2: Commit** — `test(ai): chat continuity scenario — gap, greeting, answered (AC-CC-4)`
- [ ] **Step 3: STOP** for orchestrator review.

---

### Task 5: Close-out, deploy, smoke (orchestrator)

- [ ] `close-out-review`; ADR-0013 §3.3 amendment (owner-approved 2026-09-20); BUG-018 status;
  `- Status: done`; `state.mjs --write`; merge, push, deploy, health 200.
- [ ] Smoke: one API call on the smoke user after a gap, and **the owner's own Telegram "привет"**
  (AC-CC-5) — the reply must answer the greeting.
