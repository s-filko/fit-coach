# Design — Session planning redesign (draft)

> **Status: draft from the 2026-09-23/24 owner brainstorm.** Nothing here is planned or
> approved for implementation. Every decision is marked **[owner]** (stated or confirmed by
> the owner) or **[proposed]** (the orchestrator's proposal, not yet confirmed). Open
> questions are collected in section 9. Companion spec: `2026-09-24-load-advisor-design.md`.

- Governs: the `session_planning` phase, its hand-off to `training`, the session proposal,
  the history the coach sees, the run graph around phase transitions
- Durable specs affected (escalate, never edit silently): ADR-0006 (session plan storage),
  ADR-0013 (§4.1 run = one phase, §4.2 draft channel), `docs/domain/conversation.spec.md`
  (BR-CONV-010, -015, -016), `docs/domain/training.spec.md` (BR-TRAINING-004),
  `docs/PRODUCT_VISION.md` (governing principle, section 1)
- Plans affected: `refactor-p6-progress-and-drafts` Tasks 8 and 10–12 must be redesigned
  against this spec, not executed as written

## 1. Governing principle [owner]

> **The agent behaves like a good human coach.** Everything under the hood — tool calls,
> analysis, storage — is what a good coach would do in that place. What a human coach
> would not do, the agent does not do either.

Every decision below is checked against it. Pending: owner approval to record the principle
in `docs/PRODUCT_VISION.md` (durable spec).

## 2. Problem

Findings from reading the code on `dev` (2026-09-23):

1. **Planning is a gate.** Training can only be entered through `start_training_session`
   from `session_planning`, which requires a plan (`SessionRecommendationSchema`,
   `exercises.min(1)`). There is no way to train without an agreed plan, and no `log_set`
   before the gate — the root of BUG-022.
2. **Agreeing and starting are one action.** `start_training_session` accepts the plan,
   creates the session and transitions to `training` in one call. "The plan is fine, I'll go
   tonight" cannot be expressed; the model must decide whether agreement means "start now"
   (a contributor to BUG-015).
3. **The proposal exists only as chat text.** It is regenerated as tool arguments at start;
   nothing guarantees the saved plan is the one discussed, and it does not survive a
   pause/compaction as an object.
4. **Template ranking is done by the model** from prompt prose (`session_planning/v2.ts`
   STEP 1 a–g) — deterministic arithmetic handed to the LLM.
5. **Rigid script.** "Ask exactly ONE question, do not propose yet" and the off-topic guard
   ("shall we pause planning?") are not what a human coach does (section 1).
6. **The message that triggers a transition is answered by the old phase.** Graph:
   `prepare → route → phase → commit → END` (`conversation.graph.ts:132-136`). Reporting sets
   in `session_planning` is answered without `log_set` even when the transition fires in the
   same run — the structural half of BUG-022; also BUG-001/011 class.
7. **History seen by the coach is fragmented.** `session_planning.recent_history`: last 5
   sessions, any status, `sessionKey` labels, no absolute dates, non-strength sets rendered
   as a bare type name (`cardio_distance`), no RPE/feedback. `training.previous_session`:
   rich, but picked by exact `sessionKey` (BUG-030).
8. **Finding to verify and file:** `findRecentByUserId` (`workout-session.repository.ts:126`)
   has no status filter — skipped/unfinished sessions count as "recent", and
   `daysSinceLastWorkout` takes their `createdAt` as the last workout date.

## 3. Product model

- **D1 [owner] — Planning is a conversation before training.** The user mostly asks "what
  should I do today?"; the coach analyses and proposes; the user discusses or agrees. The
  training may start right away, later (hours, next day), or never.
- **D2 [owner] — A pause does not cancel planning.** The user can go silent and return a day
  later with "let's go" or continue refining the same proposal. Leaving is not a cancel.
  Today the phase already persists in the checkpoint indefinitely; cancel exists only as
  `request_transition({toPhase:'chat'})` on explicit refusal or the off-topic guard.
- **D3 [owner] — A plan is a guide, not a contract.** The user may deviate freely; the
  journal records what was actually done. Deviation is neither an error nor a cancel. (The
  training phase already works this way: lazy `session_exercises`, off-plan section,
  `training-workout-overview.v1.ts:28`.)
- **D4 [owner] — A plan exists only when requested.** No silently generated plan "for the
  record": the user who walks in and trains spontaneously has a session with no plan.
  **Invariant [proposed]:** the coach never refers to a plan the user did not request or
  accept.
- **D5 [owner] — Planning on request during training.** "Did chest, what next?" → the coach
  analyses recent history, recovery, what was done *today*, and goals, and proposes the rest
  ("next this and this; if you have time, a cool-down and that"). The plan is built in the
  natural course of the workout, as with a human coach.
- **D6 [owner] — The workout plan is the basis.** `plan_creation` stores session templates
  (`workout_plans.plan_json`: `key`, `name`, `focus`, exercises). A session proposal is a
  template adapted to today. Template keys (`upper_a`, `lower_b`) are internal labels and
  must not leak to the user as names [owner observation]; show the focus in the user's
  language [proposed]. `session_key` becomes an origin label, never a history lookup key
  [proposed; fixes the BUG-005/030 root].

## 4. Proposal storage [proposed — revised after owner challenge]

No new table. `workout_sessions` already models this and the capability is unused:
`status` defaults to `'planning'`; `session_plan_json` is documented as "Updated during
session_planning phase, read-only during training"; `beginSession()` performs
`planning → in_progress`; `getActiveOrPlanning` (`training.service.ts:274`) looks up a
planning row.

- First proposal → create the row with `status='planning'`.
- Each revision → overwrite `session_plan_json` (whole JSON, no patches).
- "Let's go" (any time later) → `beginSession`.
- A new proposal overwrites the existing `planning` row; an abandoned proposal stays
  `planning` until replaced — it is never marked `skipped` (an unused proposal is not a
  skipped workout).
- Required: a partial unique index "at most one `planning` row per user" (like
  `uq_workout_sessions_one_in_progress_per_user`); a status filter in `findRecentByUserId`
  (section 2, point 8).
- Mid-training proposals (D5) write into the open session via the existing, unused
  `trainingService.updateSessionPlan`, appending to what is done rather than replacing it.
- The proposal schema needs a core part and an optional part ("if you have time")
  [proposed]; `SessionRecommendationSchema` is a flat `exercises.min(1)` list today.

## 5. Tools and validation [proposed]

| Today | Proposed |
|---|---|
| `start_training_session(full plan)` = agree + create + transition | `propose_session(full JSON)` saves the proposal; `start_training()` takes **no arguments** and opens a session with the current proposal, or with none |
| Catalog-ID check and fact-constraint guard run only at start | They run on `propose_session`; the model fixes errors within the same turn, the user never sees them. The guard applies to the coach's *suggestion*, never to what the user actually did |
| Full-plan payload regenerated at start | Gone — nothing to diverge |

## 6. Language and plan presentation [owner principle; mechanism proposed]

- **[owner]** All user-facing multilinguality is English → user language, done by the LLM.
  No stored translations; the catalog stays English. The system prompt carries everything to
  convey, the LLM renders it.
- **[owner]** Risk: the LLM may not follow the prompt and alter injected content. Needs a
  dedicated design — e.g. data sections marked "present verbatim in the user's language;
  translate names only; do not change numbers, order or composition; add nothing".
- **[proposed]** Deterministic post-check: after the reply, code verifies every exercise's
  numbers from the JSON (sets×reps, weight, rest) appear in the text; on mismatch one
  regeneration with the error named. Names cannot be checked (translated), numbers can. The
  same mechanism applies elsewhere (BUG-030 "last weight").
- Rejected: code-rendered plan cards — code cannot translate labels.

## 7. History the coach sees [owner direction; details proposed]

- **[owner]** The coach should see the last 2–3 sessions as wholes — how they went, loads,
  RPE, rest — rather than per-exercise dumps; the latter can confuse. (Per-exercise
  *computed* analysis belongs to the load advisor spec, not to this block.)
- **[owner, 2026-09-24] Everything is selected by muscle group, on two levels:**
  - **Level 1 — overview (what to train today):** the whole recent history in order — the
    last 2–3 sessions — plus per-muscle status over a recent window.
  - **Level 2 — exercise level (how to do this exercise):** how the exercise's muscles have
    worked recently — every exercise that loaded any of them (primary or secondary,
    labelled), dated. The same exercise is the load anchor; other exercises are fatigue
    context only. A lookup by exercise alone would hide yesterday's hard session on the same
    muscles.
  - Base: `docs/PLAN-muscle-centric-history.md` (2026-03, unimplemented) — its flaws and
    retirement are in the roadmap, step R1.3.
- **[proposed]** Format: absolute date + "N days ago"; no template labels; all set types
  fully rendered with one formatter (two exist today, one drops cardio data); English data;
  roughly 1–1.5k tokens of the 6000 `domain` budget.
- **Data gaps:** no session-level "how it went" note exists (candidate: a coach note at
  `finish_training` and/or the user's words); rest is not stored and is only derivable from
  set timestamps when logged live — batched or retro logging makes it wrong.

## 8. Run graph and interim message [proposed — owner asked to revisit the loop later]

- **Loop through the transition.** A conditional edge `commit → route` when a transition
  was committed; at most 1–2 hops per run; no return to a phase already visited in the run;
  LangGraph `recursionLimit` as a backstop. The new phase answers the triggering message in
  the same run (BUG-022 structurally; chat → planning answers with the analysis at once).
- Consequences: the user receives only the last phase's reply (today every non-empty AI
  message is delivered, AC-CC-3, `conversation-run.adapter.ts:147`); `commit` projection
  becomes incremental (today it slices "from the last human message" and would duplicate);
  one run row carries a phase path instead of `phaseIn/phaseOut`; transition tools become
  silent hand-offs (drop "write a brief closing message"); `prepare` checks do not re-run on
  the second hop.
- Pre-check before designing: 1–3 probe calls on Gemini via OpenRouter and on Z.AI — does a
  provider accept history with tool calls for tools absent from the current tool set?
- **Interim message [owner].** Between hops the user gets a short progress message that sets
  expectations ("checking your history…"), then the final answer.
  - **[owner]** Written by a cheap LLM from a per-transition *intent* template, so it is in
    the chat's language (the `infra/ai/messages` catalog only knows `ru`/`en` from the
    Telegram `language_code`).
  - **[proposed]** Input = template + the user's last message only (no tool results — nothing
    to misreport); profile `LLM_PROFILE_INTERIM_*`, `reasoning_effort=low`, ~60 tokens; via
    `LlmGateway` (audit, cost); versioned prompt modules with L0 snapshots; on failure send
    nothing (no catalog fallback — silence beats the wrong language); recorded as a
    transcript system note, never in model history.
  - **[proposed]** Delivery: `/api/bot/chat` streams NDJSON (`interim` … `final`) for clients
    that request it; the bot sends each `interim` at once and keeps typing until `final`.
    `RunResult`, the run adapter, the scenario runner and the eval harness move to a list of
    deliveries.

## 9. Open questions

1. Interim call timing: parallel with the second hop, sent only if ready before the final
   (recommended), or sequential (+1–2 s per transition turn).
2. Proposal lifetime: e.g. until the end of the user's local day?
3. History windows (section 7): level-1 window and level-2 "recent" window.
4. Recording the governing principle in `PRODUCT_VISION.md`.
5. The run-graph loop (section 8) — owner asked to return to it.
6. Off-topic guard: drop it (a pause no longer cancels) or keep a softer form?
7. Should a new day's "let's go" on yesterday's proposal trigger a fresh recovery check?

## 10. Expected effect on bugs

BUG-022 structurally closed (section 8); BUG-015 loses its basis (agreement ≠ start;
argument-less start); BUG-001/011 class improved (the new phase answers in the same turn);
BUG-030 root removed (`session_key` no longer a lookup key). BUG-024 remains separate.

## 11. Order of work

Owned by `2026-09-24-coach-roadmap.md` (steps, units, gates) — not repeated here.
