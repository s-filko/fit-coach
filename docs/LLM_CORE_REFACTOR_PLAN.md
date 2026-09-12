# LLM Core Refactor — Master Plan

**Target**: `docs/adr/0013-llm-core-target-architecture.md` (ADR-0013). **Quality gate**: `docs/PROMPT_EVAL_FRAMEWORK.md`.
**Executor**: AI coding agent(s) working in small PRs on `dev`, deployed with `./deploy/deploy.sh dev` (see root `CLAUDE.md`). No architectural decisions are left open here; product questions are listed as OQ-* in ADR-0013 §12 with a default that this plan assumes.

Conventions: each phase lists Scope (what changes), Not in scope, Depends on, Acceptance criteria (`AC-13xx`, checkable), Rollback condition (when to revert the phase's PRs), and Notes for the agent. Phases are ordered so that every phase leaves `dev` deployable. Do not merge two phases in one PR.

Open questions are answered in ADR-0013 §12 (with status tags): OQ-1 = retire **both** legacy mini-app LLM endpoints (410), no migration; OQ-2 = 3 h; OQ-3 = judge profile on Gemini 3 Flash PAYG [RECOMMENDATION]; OQ-4 = indefinite retention, 14-day checkpoint pruning; OQ-5 = catalog by `language_code`, English fallback; OQ-6 = store `source_turn_id`.

**Hard precondition for P0**: backlog item **HB-01** (`docs/PLAN-architecture-refactor-backlog.md`) — replace `drizzle-kit push` on container start with real `drizzle/` migrations in all environments. P0 adds tables/columns; they must ship as migrations only. HB-02 (production image) is recommended in the same ops PR.

---

## Phase map

```
P0 Safety net (run log, promptVersion stamping, transcript capture, eval harness L0/L1, dead-code removal)
P1 Legacy path consolidation (LlmGateway, model profiles, delete LLMService)          ← P0
P2 Prompt modules + directive versioning + context assembler (no behaviour change)      ← P0
P3 State/tool plumbing (contextSchema, Command from tools, PhaseSpec factory,
   shared tool executor, ToolOutcome, message catalog)                                  ← P2
P4 Memory model (messages channel, compaction, token budget, transcript projection,
   deleteThread)                                                                        ← P3, eval baseline from P0/P2
P5 Concurrency + delivery hardening (thread mutex, error mapping, bot watchdog/queue)   ← P3 (can run parallel to P4)
P6 Capability enablers (user_facts + remember_fact, muscle-centric blocks, plan draft)  ← P4
P7 Docs reconciliation + CI eval gate as required check                                 ← P4, P6
```

Estimated size is intentionally omitted; each phase is 1–4 PRs.

---

## P0 — Safety net and measurement

**Why first**: nothing else can be judged "better or worse" until runs are recorded and a baseline exists. Also removes dead code so later phases touch less.

Scope
1. DB: add `conversation_runs` table and `run_id`, `kind`, `payload` columns on `conversation_turns` (ADR-0013 §8). Drizzle migration via `drizzle:generate`; **never** `drizzle:push` blindly (CLAUDE.md).
2. Stamp every run: generate `runId` in `chat.routes.ts`, pass it via config `metadata` (LangChain strips `configurable` from the options callback handlers receive, so `metadata` — which is inherited by nested runs — is the only channel that reaches the handler; discovered during P0 execution), write one `conversation_runs` row in `persist.node.ts` (temporary home until P3 `commit`). Fields available today: phase, model, latency, tokens (from `llmOutput.tokenUsage` via the callback handler), tool call names from subgraph messages, outcome. `prompt_versions` = `{ 'phase.<name>': 'v0', 'directives': 'v0' }` until P2.
3. The run's `info` log line (`runId, phase, promptVersions, tokens, latencyMs` — "Conversation run recorded") is emitted by `persist.node.ts` next to the row write; `LLMLogHandler` stays `debug`-only (replay payload) and feeds the run-metrics accumulator.
4. Delete zero-consumer code: `domain/user/services/prompt.service.ts`, `domain/user/ports/prompt.ports.ts` (move `ChatMsg` to `domain/ai` temporarily), `domain/user/services/prompts/*`, `domain/training/training-intent.types.ts`, `domain/training/plan-creation.types.ts`, `parseSessionPlanningResponse` + `SessionPlanningLLMResponseSchema`, `PROMPT_SERVICE_TOKEN` registration. Keep `LLMService` until P1.
5. Eval harness skeleton under `apps/server/evals/` (runner, dataset schema, L0 static checks, L1 deterministic checks with a real model behind `RUN_LLM_EVALS=1`), and the first golden datasets (≥10 cases per phase) written from `docs/MANUAL_TEST_PLAN.md` scenarios and BUGS.md regressions (BUG-006, -008, -009, -011). Record a **baseline** for the current prompts (`promptVersions v0`). See eval spec §3–§5.
6. Transcript export script: `npm run evals:export -- --since <date>` dumps runs+turns to JSONL for dataset curation (PII fields redacted per LOGGING_GUIDE "Forbidden data").

Not in scope: any prompt wording change; any state change.

Depends on: HB-01 merged and deployed to dev and prod (migrations are the only schema mechanism). Verify: `grep -rn "drizzle-kit push" apps/server/docker-entrypoint.sh deploy/` → empty.

Acceptance criteria
- AC-1301 Every `POST /api/bot/chat` produces exactly one `conversation_runs` row with non-null `run_id, phase_in, model, latency_ms, outcome`; verified by integration test with the stub graph replaced by a `MemorySaver` graph and mocked model.
- AC-1302 `npm run type-check && npm run lint && npm run test:unit` pass with the dead code removed; `grep -r "PromptService\|training-intent.types\|plan-creation.types" apps/server/src` returns nothing.
- AC-1303 `npm run evals -- --level L0` passes offline; `RUN_LLM_EVALS=1 npm run evals -- --level L1 --phase all` runs against dev keys and writes `evals/baselines/v0/*.json`.
- AC-1304 Deployed to dev; a manual 5-message registration flow shows 5 run rows with token counts > 0. (Verified 2026-09-12 with 2 messages / 2 rows — owner-approved deviation; two rows demonstrate one-row-per-request, drain isolation, and non-zero tokens. See `docs/superpowers/plans/refactor-p0-run-log.md` Task 6.)

Rollback condition: run-row writes add > 100 ms p95 to `/api/bot/chat` (measure from `latency_ms` vs Fastify `responseTime`) or cause any 5xx — revert item 2 only; keep the rest.

Notes: `conversation_turns.kind` for existing rows defaults to `'human'|'ai'` by role via migration backfill. Do not attempt to backfill `run_id`.

---

## P1 — Legacy LLM path consolidation

Scope
1. New port `domain/ai/llm.gateway.ports.ts` (`LlmGateway { chat, structured }`), implementation `infra/ai/llm.gateway.ts` over `getModel(profile)`; `withStructuredOutput` with one retry on Zod failure; every call logged with `runId` (or `jobId`) and profile.
2. `model.factory.ts`: `getModel(profile = 'default')` with config overrides `LLM_PROFILE_<NAME>_{MODEL,TEMPERATURE,MAX_TOKENS}` (all optional; `config/index.ts` schema extended; no new required env vars).
3. `TrainingService`: remove `llmService` constructor dependency; delete `createPlanFromPrompt`, `getNextSessionRecommendation`, `recommendForSession`, `generateFreeformRecommendation` and their port declarations (`domain/training/ports/service.ports.ts:73-78`). `POST /api/app/plan` and `POST /api/app/session/:id/recommend` return `410 { error: { code: 'RETIRED' } }` (OQ-1, owner-confirmed direction). `SessionPlanningContextBuilder` stays — its only consumer is the session-planning subgraph.
   **Precondition (OQ-1 [ASSUMPTION])**: before merging the 410 PR, check prod access logs (NPM/Fastify logs on `ssh filko.dev`) for `POST /api/app/plan` and `POST /api/app/session/*/recommend` over the last weeks. If real usage appears, stop and surface it to the owner; do not ship the retirement silently.
4. Delete `infra/ai/llm.service.ts`, `domain/ai/ports.ts` `LLMService`, `LLM_SERVICE_TOKEN`, test setup registration (`app/test/setup.ts:155-156`).
5. `phase-summary.node.ts` switched to `LlmGateway.structured` with the ADR-0010 schema and `profile: 'summarizer'` (still fire-and-forget until P4; only the call site changes).

Depends on: P0 (run log fields for gateway calls).

Acceptance criteria
- AC-1311 `grep -rn "jsonMode\|json_object\|LLMService" apps/server/src` → empty.
- AC-1312 Integration tests: `POST /api/app/plan` and `POST /api/app/session/:id/recommend` return `410` with body `{ error: { code: 'RETIRED' } }` (auth still enforced first: 401/403 without valid `initData`). `grep -rn "recommendForSession\|createPlanFromPrompt\|getNextSessionRecommendation\|generateFreeformRecommendation" apps/server/src` → empty. `docs/API_SPEC.md` marks both endpoints retired.
- AC-1313 Exactly one `ChatOpenAI` construction site remains (`model.factory.ts`).
- AC-1314 Config with no `LLM_PROFILE_*` variables behaves identically to before (unit test on `getModel('summarizer')` falling back to defaults).

Rollback condition: the prod log check reveals real callers of either retired endpoint after the 410 PR shipped — revert the route change (restore the previous handlers on top of a temporary `LlmGateway.structured` adapter, never `LLMService`) and escalate to the owner.

---

## P2 — Prompt modules, directive versioning, context assembler (behaviour-preserving)

Scope
1. Create `infra/ai/prompts/` per ADR-0013 §5. Move each inline prompt into `phases/<phase>/v1.ts` **verbatim** (same text, same order), splitting into `Section`s at the existing `===` headers. Move each `composeDirectives` function into `directives/<name>.v1.ts`. `compose.ts` reproduces today's concatenation exactly.
2. `render()` becomes pure: `now`, `timezone`, `client` come from `PromptContext`; no `new Date()` inside prompt modules (today's `formatInUserTz(new Date(), …)` in `plan-creation.node.ts:7` etc. moves to the caller).
3. `infra/ai/context/assemble-context.ts` + `token-estimator.ts` (chars/4 with a 1.15 safety factor for Cyrillic-heavy text; single implementation, unit-tested). In P2 the assembler only **reports** budget usage (`budgetReport`), it does not trim yet; each subgraph's `agentNode` calls the assembler instead of hand-building messages, preserving today's message order per phase (including training's system-block history — changed in P4).
4. `promptVersions` recorded per run (replaces the `v0` placeholder from P0).
5. Snapshot tests: for each phase and a fixed `PromptContext` fixture, the rendered system prompt equals the pre-refactor output (capture the pre-refactor strings first, commit as `__snapshots__`). Russian literals remain where they are in P2 (they move to the catalog in P3).

Depends on: P0.

Acceptance criteria
- AC-1321 Rendered prompts are byte-identical to pre-refactor output for all five phases across three fixtures each (empty profile, complete profile, active session) — snapshot tests green.
- AC-1322 L1 eval pass rates for `v1` prompts are within ±2 percentage points of the `v0` baseline on every dataset (statistical noise band; run with `n=3` samples per case).
- AC-1323 `budgetReport` is logged for 100% of runs; a dashboard-free check: `SELECT phase_in, avg((budget_report->>'total')::int) FROM conversation_runs GROUP BY 1` returns numbers for all phases after a manual smoke test on dev.
- AC-1324 `grep -rn "new Date()" apps/server/src/infra/ai/prompts` → empty.

Rollback condition: AC-1322 fails after two investigation attempts — revert the assembler wiring (item 3) while keeping the prompt modules (items 1–2).

Notes: measure the session-planning system prompt size here (ADR-0013 §3.4 hypothesis) and record it in the PR description; it sets P4's budget defaults.

---

## P3 — State and tool plumbing

Scope
1. `infra/ai/graph/state.ts`: parent `Annotation.Root` per ADR-0013 §3.2 **plus** `contextSchema` for run context. Remove `user`, `userMessage`, `responseMessage` channels. The route builds the run context (`runId, userId, now, client: 'telegram', trigger: 'user_message'`) and passes the user message as the first `HumanMessage` in `messages` input. Move `domain/conversation/graph/*` to `infra/ai/graph/`; domain keeps `phases.ts` and `transitions.ts` (matrix + guard predicates, pure, unit-tested).
2. `prepare` node (loads `user` into run context, resets `pendingTransition`, keeps router safety sync), `route` node (Command with `ends`).
3. `phase-subgraph.factory.ts` + five `PhaseSpec`s. Shared `tool-executor.ts` implementing: priority ordering, `log_set` batch dedup, `search_exercises` per-turn dedup, dynamic availability, `llmErrorBudget`, `Command` returns, `ToolOutcome` serialisation. Delete `dedup-tool-node.ts`, `sequentialToolNode`, `invokeWithRetry` (its nudge moves into the shared agent node), `PendingRefMap`.
4. Tools return `ToolOutcome`; transition/session-id updates via `Command({ update: { pendingTransition, activeSessionId } })`. Tools read `userId`/`activeSessionId` from `config.configurable`, populated by the executor from run context and state.
5. `commit` node = persist (P0 run row + turns) + transition guard + side effects; delete `persist.node.ts`, `transitionGuardNode`, `cleanupNode` inline functions.
6. Message catalog `infra/ai/messages/{en,ru}.ts`; all user-facing literals in graph code (router/cleanup replies, training error `AIMessage`s) read from it by `user.languageCode` with English fallback.
7. Route returns the last `AIMessage` text; `ICompiledConversationGraph` port becomes `ConversationRunPort.run(input, ctx) → { text, phase, runId }` and the route no longer imports `@infra/ai`.

Not in scope: `messages` persistence across runs (P4) — in P3 the parent `messages` channel is still cleared at the end of each run by `commit` (emit `RemoveMessage` for all), so behaviour stays "history from DB + in-flight", exactly as today.

Depends on: P2.

Acceptance criteria
- AC-1331 `grep -rn "PendingRefMap\|pendingTransitions\|currentSessionIds" apps/server/src` → empty; no module-level mutable state in `infra/ai/graph/**` except compiled graphs.
- AC-1332 Unit tests for the shared executor cover: ordering (existing ADR-0011 tests pass unchanged), batch dedup, `Command` propagation of `pendingTransition` and `activeSessionId`, `system_error` short-circuit, `llm_error` budget exhaustion → catalog message.
- AC-1333 `domain/**` imports no `@langchain/*` (ESLint boundary rule added and green).
- AC-1334 L1 eval pass rates within ±2 pp of the P2 baseline for all phases; the transition datasets (chat→session_planning, session_planning→training, training→chat) pass ≥ P2 rates.
- AC-1335 Every response body on `/api/bot/chat` matches the existing contract (`{ data: { content, timestamp } }`) — integration tests unchanged and green.

Rollback condition: any transition scenario in the L1 transition dataset drops by > 5 pp, or a manual dev session shows a lost `activeSessionId` — revert the phase (single revert commit; P2 remains valid).

---

## P4 — Memory model (the behaviour-changing phase)

Scope
1. Stop clearing `messages` in `commit`; the parent channel is now the episode memory (INV-LLM-001/002). `commit` appends the run's new messages (human, ai incl. tool calls, tool results) to `conversation_turns` with `kind`/`payload` — the transcript projection.
2. `compact` step inside `prepare` per BR-LLM-001..004 with `EpisodeSummary` (structured, via gateway profile `summarizer`), `episodeSummaries` (≤3), `RemoveMessage` emission, and mirror to `conversation_summaries`. Delete `phase-summary.node.ts`, `insertPhaseSummary`, `getLatestSummary`, `getLastUserMessageTime` (last-message time now comes from state), `insertContextReset` and the `__context_reset__` marker.
3. Assembler enforces budgets (`trimMessages` on history, block depth reduction, summary dropping — ADR-0013 §3.4 order) using P2's measurements for defaults; all phases use the same message-channel history (training's system-block history removed).
4. `getMessagesForPrompt` deleted; `IConversationContextService` replaced by `TranscriptPort` (append-only) and `SummaryPort`. `clear-context` = `checkpointer.deleteThread(userId)` + a `system_note` turn; raw SQL on checkpoint tables removed.
5. Checkpoint pruning script `db:prune-checkpoints` (BR-LLM-005) + a cron note in `deploy/` docs (owner runs it; no scheduler added to the app).
6. Migration of live threads: on the first run after deploy, existing checkpoints have no `messages`; `prepare` seeds nothing (history starts fresh) but the previous rolling summary row (`role='summary'`) is imported once as the sole `EpisodeSummary` so users do not lose context. One-off, guarded by `episodeSummaries.length === 0 && messages.length === 0`.

Depends on: P3; P0/P2 baselines.

Acceptance criteria
- AC-1341 After two consecutive runs in one episode, the second run's LLM input contains the first run's tool calls and tool results (integration test with `MemorySaver` and a mocked model asserting on the messages it receives).
- AC-1342 With `EPISODE_GAP` mocked to 0 between two runs, the second run's input contains exactly one `EpisodeSummary` block and no messages from the first run; `conversation_summaries` has one row.
- AC-1343 A synthetic 60-turn training transcript replayed through the graph never exceeds the training history budget (assert on `budgetReport.history ≤ budget.history` for every run) and never sends an orphan `ToolMessage` (provider would reject it).
- AC-1344 L1 datasets: plan_creation "reuses exercise IDs without re-searching" cases improve vs P3 baseline (target: ≥ +15 pp on `no_redundant_search`); all other datasets within ±2 pp. L2 judge score (mean) not lower than baseline by more than 0.2 on any phase.
- AC-1345 `SELECT count(*) FROM conversation_turns WHERE kind IN ('tool_call','tool_result')` grows on dev after a plan-creation smoke test.
- AC-1346 `grep -rn "getMessagesForPrompt\|getLatestSummary\|__context_reset__" apps/server/src` → empty.

Rollback condition: AC-1344 fails for two phases after tuning budgets once, or any provider rejects a request because of message ordering (`tool` message without preceding `tool_calls`) in dev logs — revert P4 as a unit; P3 remains deployable (it still reads history from DB).

Notes: `trimMessages` must be called with `startOn: 'human'` and the executor must keep `AIMessage(tool_calls)`+its `ToolMessage`s together; write the unit test for the "cut in the middle of a tool pair" case first.

---

## P5 — Concurrency and delivery hardening (parallel to P4)

Scope
1. `app/services/conversation.service.ts`: per-`userId` in-process keyed mutex around `graph.invoke` (wait ≤ 20 s then `ThreadBusyError` → 409). Single instance is a stated constraint; document that a multi-instance future needs a DB advisory lock (`pg_advisory_xact_lock(hashtext(userId))`) in the same place.
2. Error mapping per ADR-0013 §6 table; `chat.routes.ts` returns codes, never `error.message`. Fastify `requestTimeout` (30 s today, `server.ts:69`) is checked against the observed p95 run latency from `conversation_runs` and raised if needed (planning turns with several tool rounds may exceed it — HYPOTHESIS; verify with `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FROM conversation_runs WHERE phase_in IN ('plan_creation','session_planning')`).
3. Bot (`apps/bot`): watchdog on `polling_error` (BUG-012): `EFATAL` or ≥10 consecutive errors within 2 min → structured log + `process.exit(1)`; per-chat sequential queue (a `Map<chatId, Promise>` chain) so a fast double-send is serialised client-side too; map `LLM_UNAVAILABLE`/`THREAD_BUSY`/`CORE_ERROR` to localized texts; call `POST /api/bot/user` only on `/start` and on 404 from chat (cache `userId` per chatId in memory; falls back to upsert on miss).
4. `conversation_runs.outcome` reflects the mapped error class.

Depends on: P3 (error envelope). Independent of P4.

Acceptance criteria
- AC-1351 Two concurrent `POST /api/bot/chat` for the same `userId` (integration test, mocked slow model) execute sequentially: run rows have non-overlapping `[created_at, created_at + latency]` windows; different users run concurrently.
- AC-1352 With the model mocked to throw a provider error, the route returns 503 `{ error: { code: 'LLM_UNAVAILABLE' } }` and no stack/message text; run row `outcome='llm_unavailable'`.
- AC-1353 Bot unit test: injecting an `EFATAL` polling error makes the process call `exit(1)` within the window (exit stubbed).
- AC-1354 Bot sends a localized fallback (ru for `language_code='ru'`, en otherwise) for each error code (unit tests on the mapper).

Rollback condition: 409s observed for single-message users on dev (mutex leak) — revert item 1 only.

---

## P6 — Capability enablers

Scope
1. **User facts (ADR-0009)**: `user_facts` table (with `source_turn_id` referencing `conversation_turns`, OQ-6) + `IUserFactsService`; `remember_fact` tool in all `PhaseSpec`s; long-term block `## User Facts` rendered by the assembler (cap 50, ordered by category then recency); **hard validation**: `save_workout_plan`, `start_training_session` reject exercises whose primary muscles conflict with a `physical_constraint` fact tagged with a muscle group (facts get an optional `muscleGroup` field) → `user_error` outcome with the fact quoted. Prompt modules bump to a new version with the `memory-usage` directive.
2. **Muscle-centric progress blocks (BUG-005, `PLAN-muscle-centric-history.md`)**: repository methods `getMuscleRecovery(userId, days)` and `getExerciseHistoryByMuscles(userId, muscles, limit)`; context blocks `muscleRecovery` (session_planning) and `currentExerciseHistory` (training, keyed by the in-progress exercise's primary muscles; refreshed each run). Remove `findLastCompletedByUserAndKey` usage from prompts.
3. **Structured drafts**: `draft` channel; tools `propose_plan_draft`/`update_plan_draft` (plan_creation) and `propose_session_draft`/`update_session_draft` (session_planning); `save_workout_plan`/`start_training_session` take no payload and persist the current draft; prompts updated to "edit the draft, then save". Deterministic eval checks read the draft (eval spec §4.2).

Depends on: P4 (blocks and drafts rely on the assembler and state).

Acceptance criteria
- AC-1361 Eval `memory/facts` dataset: after a constraint is stated in chat, the next session_planning run's input contains the fact and the proposed draft contains no conflicting exercise (deterministic check on the draft); ≥ 90% pass over n=3.
- AC-1362 Eval `progress/history`: with fixture history in a different `sessionKey`, the training run's input contains the exercise's previous sets (deterministic: block present with ≥1 set) — 100%; judge criterion TR-6 ("references last performance with correct numbers") mean ≥ 4.0/5.
- AC-1363 Eval `plan/iteration`: a 4-turn scripted iteration ends with `save_workout_plan` persisting a plan equal to the last draft (deep-equal), and the draft's exercise IDs all exist in the catalog — 100%.
- AC-1364 No regression > 2 pp on other datasets; L2 means not lower by > 0.2.

Rollback condition: any of AC-1361..1363 below target after one prompt iteration — revert the corresponding item only (the three items are independent PRs).

Notes: the item 2 prompt version bump also folds in a carried-over rule (TODO review, 2026-09-11): after every logged set the response must contain a concrete next-set recommendation (weight or rep target), never a bare confirmation — today the prompt requires this only conditionally (RPE ≥ 8 / reported difficulty).

---

## P7 — Docs reconciliation and CI gate

Scope
1. Rewrite `docs/domain/conversation.spec.md` and `docs/domain/ai.spec.md` against the new ports (≤50 lines each, ID continuity: keep BR-CONV-002/003/007/015–018, mark others superseded by BR-LLM-*). Update `ARCHITECTURE.md` module layout and "Conversation Context" and "LLM Integration" sections; archive `CONVERSATION_CONTEXT_ARCHITECTURE.md` to `docs/archive/`; update FEAT-0003 flow diagram; mark ADR-0005/0007 sections superseded; set ADR-0009/0010/0011 statuses to ACCEPTED/IMPLEMENTED as applicable; add `docs/PLAN-*.md` outcomes to BUGS.md entries (BUG-005 fixed by P6).
2. CI: `evals:L0` on every PR; `evals:L1 --changed` (datasets for phases whose prompt module or tool changed) as a required check on PRs touching `infra/ai/prompts/**`, `infra/ai/tools/**`, `infra/ai/context/**`; nightly full L1+L2 on `dev` with baseline comparison and a failing job on regression (eval spec §7). Secrets: dev OpenRouter key as a GitHub secret (owner action).
3. `CONTRIBUTING_AI.md`: the prompt change protocol (eval spec §8) becomes mandatory.

Depends on: P4, P6.

Acceptance criteria
- AC-1371 `docs/domain/*.spec.md` port sections match `apps/server/src/domain/*/ports/*.ts` exports (a script `npm run docs:check-ports` diffs interface method names; green).
- AC-1372 A PR that changes one word in `phases/chat/vN.ts` without bumping the version fails CI (L0 check "version bump required").
- AC-1373 Nightly workflow produces `evals/reports/<date>.md` with per-dataset pass rates and judge means vs baseline.

Rollback condition: none (docs/CI); if the L1 required check is flaky (> 1 spurious failure per week), demote it to advisory and raise `n` per case.

---

## Cross-phase rules for the executing agent

- Read ADR-0013 §1 before touching a file it cites; keep the cited behaviours unless the phase says otherwise.
- Every PR: `npm run check-all && npm run test:unit`; for P2+ also `npm run evals -- --level L0`; for prompt/tool changes run L1 for the affected phase and paste the pass-rate table into the PR description.
- Never change prompt wording in a plumbing phase (P0, P1, P3, P5). If a wording change is unavoidable, it is its own PR with a version bump and an eval run.
- Do not add frameworks: the eval runner is TypeScript + Jest (see eval spec §9 for why promptfoo/LangSmith are optional, not required).
- Deploy each phase to dev and run the manual smoke list in `docs/MANUAL_TEST_PLAN.md` §"Smoke" before starting the next phase.
