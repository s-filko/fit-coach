# Prompt Evaluation Framework — Specification

**Purpose**: make "did this prompt change make the coach better or worse?" an answerable question with a number, per conversational phase, before and after every change. Companion to ADR-0013 (§5 prompt architecture, §8 run records) and `LLM_CORE_REFACTOR_PLAN.md` (P0, P7).

Industry practices this design relies on (named so an agent can look them up): **eval-driven development** and error analysis on real traces (Hamel Husain, "Your AI Product Needs Evals"; Shankar et al., "Who Validates the Validators"); **golden regression suites** run in CI (OpenAI Evals, promptfoo's assertion model); **LLM-as-a-judge with calibration against human labels and position-bias controls** (Zheng et al., "Judging LLM-as-a-Judge with MT-Bench"); **rubric-anchored scoring** (G-Eval style chain-of-thought rubric scoring); **deterministic checks first, model-graded checks second**; **pinned judge model + versioned prompts + baselines** (standard prompt-management hygiene).

---

## 1. What "prompt quality" means for this product

The coach is judged on **behaviour**, not prose. Per phase, quality is the rate at which a turn (a) takes the right action (tool/transition/no action), (b) says only what is true (no invented data, no false confirmations), (c) moves the conversation forward per the phase's job, (d) respects format/language/persona constraints, and (e) uses the user's context (profile, history, facts) when it matters.

Formal definition used by all reports:

```
Quality(phase, promptVersions) = {
  action_accuracy   : L1 pass rate on tool/transition assertions            (deterministic)
  truthfulness      : L1 pass rate on forbidden-claim checks + judge TR/CH "no invented data" (mixed)
  task_progress     : judge rubric mean (1–5) on the phase's progress criteria
  constraints       : L0/L1 pass rate on format, language, persona, length
  context_use       : judge rubric mean on personalization criteria
}
```

A change is **better** if no metric regresses beyond its noise band and at least one improves; **worse** if any regresses beyond the band. Noise bands: ±2 pp for pass rates at n=3 samples per case and ≥30 cases; ±0.2 for judge means. Below 30 cases a dataset reports numbers but cannot gate.

---

## 2. Layers

| Layer | What | Needs LLM? | When it runs |
|-------|------|-----------:|--------------|
| L0 static | prompt renders, section presence, token budget, forbidden strings, version bump present | no | every PR, seconds |
| L1 deterministic | single-turn cases → run the **real** graph (mocked DB + real model) → assert tool calls, args, transition, format, forbidden claims | yes (coach model) | PRs touching prompts/tools; nightly |
| L2 judged | same runs scored by a judge model against per-phase rubrics; pairwise A/B between versions for tie-breaks | yes (judge model) | nightly; on demand for prompt PRs |
| L3 scenario | multi-turn scripted user (simulator with fixed persona/answers) → end-state assertions (DB rows, drafts, phase) + judge on the transcript | yes | nightly; before prod deploy |

Deterministic before judged: a case that fails L1 is not scored in L2 (avoids rewarding well-written wrong actions).

---

## 3. Datasets

Location: `apps/server/evals/datasets/<phase>/<dataset>.jsonl`; one JSON object per case. Sources, in priority order: (1) production runs exported from `conversation_runs`/`conversation_turns` (P0 export script; redacted), (2) BUGS.md regressions, (3) `MANUAL_TEST_PLAN.md` scenarios, (4) adversarial hand-written cases.

Case schema (`evals/schema/case.schema.ts`, Zod):

```
{
  id: 'CH-0007',                       // stable; referenced by baselines and PRs
  phase: 'chat',
  tags: ['transition', 'BUG-011'],
  fixture: {                           // domain snapshot loaded into mocked repos
    user: { languageCode: 'ru', timezone: 'Europe/Berlin', profile: {...} },
    plan?: {...}, sessions?: [...], activeSession?: {...}, facts?: [...]
  },
  state: {                             // checkpoint seed: episode memory going in
    phase: 'chat', activeSessionId: null,
    messages: [ {role:'human', text:'...'}, {role:'ai', text:'...'}, {role:'tool_call',...}, ... ],
    episodeSummaries: [...]
  },
  input: { text: 'Upper A давай' },    // the user turn under test
  expect: {
    tools:      { must: ['request_transition'], mustNot: ['log_set'], args: { request_transition: { toPhase: 'session_planning' } } },
    transition: 'session_planning' | null,
    text: { mustMatch?: [regex], mustNotMatch: ['(?i)logged|записал'], language: 'ru', format: 'telegram_html', maxChars?: 900 },
    draft?: { exerciseIdsExist: true, minExercises: 4 },
    judge: ['CH-1','CH-3','CH-5']       // rubric criteria ids to score
  },
  provenance: { runId?: 'uuid', addedBy: 'owner', date: '2026-09-10' }
}
```

Rules
- BR-EVAL-001 A case is immutable once referenced by a baseline; fix by adding a new case and deprecating the old (`deprecated: true`).
- BR-EVAL-002 Every BUGS.md entry of class "LLM did the wrong thing" gets at least one case tagged with its ID before it is marked Fixed.
- BR-EVAL-003 Fixtures contain no real user data; the export script pseudonymises names and drops free-text older than the case's own turns.
- BR-EVAL-004 Minimum viable set per phase: 30 L1 cases (≥10 "should act", ≥10 "should NOT act", ≥10 mixed/adversarial) and 5 L3 scenarios.

Initial datasets to write in P0 (from existing material): `chat/transitions` (BUG-011), `chat/no-set-logging` (BUG-009), `training/set-logging` (ADR-0011 P1–P4 patterns, BUG-008), `training/no-false-confirmation` (BUG-006/009), `session_planning/one-question-first`, `plan_creation/id-reuse` (dedup log evidence), `registration/field-extraction`, `registration/no-premature-complete`.

---

## 4. Deterministic checks (L0, L1)

### 4.1 L0 — static
- Render every current prompt module with three fixtures; assert required sections present, total estimated tokens ≤ `PhaseSpec.budget.system`.
- Forbidden strings in rendered prompts: `undefined`, `null`, `[object Object]`, `NaN`.
- Version discipline: if a `prompts/**` file changed in the diff, its `version` string changed too (git diff based).
- Message catalog completeness: every catalog key exists in `en` and `ru`.

### 4.2 L1 — behavioural, single turn
Harness: build the real compiled graph with `MemorySaver`, mocked repositories seeded from `fixture`, the real `LlmGateway` (coach model pinned by `EVAL_MODEL`, temperature as in prod), tools with **recording** side effects (no DB). Seed state via `graph.updateState`. Run `input`. Collect: tool calls (name, args, outcome kind), committed transition, final text, `draft`, `budgetReport`.

Assertions (each is a named check reported separately):
- `tools.must` / `tools.mustNot` / `tools.args` (subset match on args; ids validated against fixture catalog).
- `transition` equals expected.
- `text.mustNotMatch` — the truthfulness gate: e.g. training cases with no `log_set` outcome assert no `(✅|logged|saved|записал|сохранил)`; chat asserts no set confirmations at all; any phase asserts no raw UUIDs and no JSON braces in user text.
- `text.language` — detect script/lang with a small heuristic (Cyrillic ratio) or a tiny classifier; `text.format` — Telegram HTML only: no `**`, no `_x_`, only allowed tags; `maxChars`.
- `draft` invariants (after P6): all exercise IDs exist, sets/reps within catalog-type constraints, no exercise conflicting with a `physical_constraint` fact.
- `no_redundant_search`: same `search_exercises` args not repeated within the case's state + run.
- Structural: run `outcome === 'ok'`, `budgetReport.history ≤ budget.history`, no orphan tool messages.

Sampling: each case runs `n` times (default 3; `n=5` for gating datasets); a case passes if ≥ ⌈n/2⌉ samples pass; the report shows per-check pass rates and the flakiest cases.

---

## 5. LLM-as-judge (L2)

- Judge model: a **config profile `judge`** in `model.factory.ts` (`LLM_PROFILE_JUDGE_*`), pinned per report, temperature 0. Current setting (OQ-3, [RECOMMENDATION] — owner leaning yes, not formally confirmed): **Gemini 3 Flash via the Google AI Studio PAYG key** through OpenRouter. Rationale: out-of-family relative to the coach model (GLM), which removes self-preference bias by construction; does not consume the Z.AI subscription quota shared with dev tooling; measured ≈ $0.30 per full nightly L1+L2 run. The choice is reversible: nothing in this spec depends on which model fills the profile, and switching (e.g. to the subscription GLM model as fallback) only requires re-running calibration (§5, mandatory for any judge change). Per-dataset escalation to a Pro-tier judge profile (`judge_strong`) is allowed when calibration shows the Flash judge cannot score that dataset reliably (ρ < 0.7). Batching via Google's Batch API (50% off) is a later optimisation, not P0 — OpenRouter has no batch API, so it would mean calling Google directly. Judge prompts live in `infra/ai/prompts/judge/<phase>.vN.ts` and are versioned like any prompt; reports record `judgeVersion`.
- Input to the judge: the case's fixture summary (profile, plan, session state rendered by the same context blocks), the recent transcript, the tool calls actually executed (names + outcomes), and the coach's reply. The judge never sees the coach's system prompt (it judges behaviour, not compliance with wording).
- Output: JSON per criterion `{ id, score: 1..5, evidence: '<quote>' }` via structured output; a criterion scored without a quote is discarded.
- Position/verbosity bias controls: absolute scoring per single reply (no pairs) for nightly; **pairwise** (A/B with randomised order, both orders run) only when two prompt versions tie within noise on absolute scores.
- Calibration: `evals/calibration/<phase>.jsonl` holds ≥20 replies with owner-assigned scores; a judge version is accepted only if Spearman ρ ≥ 0.7 vs owner labels on each phase; recheck when the judge model or judge prompt changes. The owner labels 20 new production replies per phase per month (30 min) — this is the human-in-the-loop that keeps the judge honest.

### 5.1 Rubric skeletons (initial; each criterion has a checkable anchor)

Scores: 5 = fully meets anchor; 3 = partially; 1 = violates. Criteria marked **(D)** also exist as deterministic checks and are double-counted deliberately.

**Registration (RG)**
- RG-1 Extracts and saves exactly the fields the user gave; does not save fields the user did not mention (D).
- RG-2 Asks for missing fields in the prescribed groupings; at most two groups per turn.
- RG-3 Accepts approximate values ("около 70") without pedantry.
- RG-4 Never calls `complete_registration` before explicit user confirmation of the summary (D).
- RG-5 Stays on topic; redirects politely in one sentence.
- RG-6 Reply in the user's language; Telegram HTML only (D).

**Chat (CH)**
- CH-1 On explicit intent to train/plan, calls `request_transition` **and** announces the hand-off in text (D for the call).
- CH-2 Never claims to have logged/saved a set; if the user reports one, redirects to starting a session (D).
- CH-3 Advice is personalised: references at least one profile or history fact when giving guidance.
- CH-4 Scope: fitness/health only; off-topic redirected in ≤1 sentence.
- CH-5 Brevity: ≤ 6 sentences unless the user asked for detail.
- CH-6 Greeting rule: greets only when the greeting directive applies; no name in every message.

**Plan creation (PC)**
- PC-1 First response gathers the three prerequisites (days/week, minutes/session, split preference) before proposing.
- PC-2 Uses `search_exercises` before proposing exercises; reuses IDs already in context, no redundant identical searches (D).
- PC-3 Proposed plan matches the stated constraints (days, duration, equipment, level) — judge lists each constraint and whether it is respected.
- PC-4 Volume/recovery sanity: no major muscle group trained on consecutive templates without a rest rationale.
- PC-5 Saves only after explicit approval; the saved draft equals the last proposal (D after P6).
- PC-6 Exercise names localised with English in parentheses; no IDs in text (D).

**Session planning (SP)**
- SP-1 Asks exactly one contextual question before proposing (D: no `start_training_session` and no exercise list in the first reply).
- SP-2 Template choice follows the recovery timeline and neglect override; the stated reasoning cites actual days-since values from context.
- SP-3 Adapts to temporary state mentioned in the episode (soreness, time available).
- SP-4 Proposal is complete: exercises with sets/reps/rest and a closing invite.
- SP-5 Starts the session only on explicit approval; cancels via `request_transition('chat')` on clear intent (D).
- SP-6 Off-topic guard: one clarifying question, then transition if confirmed (D on the second turn in L3).

**Training (TR)**
- TR-1 Message classification: comments/questions do not trigger `log_set`; explicit set data does (D).
- TR-2 Confirms only what tools confirmed, with the tool's numbers (D for false confirmations).
- TR-3 Uses correction tools instead of re-logging; asks before destructive deletes.
- TR-4 Does not act on stale history: no tool call justified only by past-turn content.
- TR-5 Never auto-completes an exercise or finishes the session without an explicit user request (D).
- TR-6 Exercise intro references last performance with correct numbers from context (after P6 blocks) and gives one concrete recommendation.
- TR-7 Tone: no praise of technique/form; concise; no filler compliments.

**Cross-phase (XP)** applied to all: XP-1 language (D); XP-2 Telegram HTML only (D); XP-3 persona (never mentions being an AI/model); XP-4 no internal IDs/JSON in text (D); XP-5 uses user facts when relevant (after P6).

---

## 6. Versioning — how promptVersions tie logs → evals → changes

- Every run stores `prompt_versions` (ADR-0013 §8). Every eval report stores the same map plus `coachModel`, `judgeModel`, `judgeVersion`, `datasetHash`, `n`, and git SHA.
- Baselines: `evals/baselines/<phase>/<promptVersion>.json` — per-check and per-criterion aggregates for the current `dev` prompts. A baseline is (re)written only by the nightly job on `dev` after a merge that changed prompts, never by a PR.
- Reproducing a production complaint: find `run_id` in logs → `conversation_runs` gives `prompt_versions` and the input turns → `evals:case-from-run <runId>` creates a case skeleton with the exact state/fixture → add expectations → the case joins the dataset with `provenance.runId`.
- Rollback of a prompt = re-pointing `phases/<phase>/index.ts` to the previous version file; the report for that version already exists.

---

## 7. CI gates

| Trigger | Runs | Gate |
|---------|------|------|
| Every PR | L0 | required |
| PR touching `infra/ai/prompts/**`, `infra/ai/tools/**`, `infra/ai/context/**`, `evals/datasets/**` | L1 for affected phases, n=3 | required; fail if any gating dataset pass rate < baseline − 2 pp, or any `truthfulness` check < baseline |
| Nightly on `dev` | scope is config: changed phases only by default, full sweep when `--full` | writes report + baseline; opens a GitHub issue on regression (> 2 pp or > 0.2) |
| Weekly full sweep on `dev` | L1 (n=5) + L2 + L3 all phases | same as above |
| Before `deploy.sh prod` (manual) | last full-sweep report must be green and ≤ 7 days old | checklist item in `docs/CICD.md` |

Cost control: L1 for one phase at 30 cases × n=3 ≈ 90 coach calls (+ tool rounds); a full sweep ≈ 5 phases × 30 × 5 + L2 judge calls + 25 L3 scenarios ≈ 1.5–2k calls. Run scope, sample counts, and ceilings live in `evals/config.ts` — tune them to the coach-model plan quota and the judge budget whenever those change; the runner stops and marks the report `partial` when the per-run budget is exceeded. Model choice (coach profiles, judge profile) is likewise config, not architecture.

---

## 8. Prompt change protocol (mandatory after P7; recommended from P2)

1. State the hypothesis in the PR: which criterion (e.g. `CH-1`) should improve and by how much.
2. Add or point to the cases that demonstrate the problem (they should fail on the current version).
3. Create `vN+1`, change wording, keep `vN` file.
4. Run L1 for the phase (n=3); paste the table: per-check pass rate `vN → vN+1`.
5. If the change targets a judged criterion, run L2 on the phase and paste means; if within noise, run pairwise.
6. Merge only if the hypothesis criterion improved and nothing regressed beyond noise. Nightly rewrites the baseline.
7. Watch `conversation_runs` for the next 3 days: `outcome` mix and the affected dataset's production counterparts (query by `tags` via `evals:sample-runs --phase chat --since 3d` which lists recent runs for manual labelling).

---

## 9. Tooling decisions

- Runner: TypeScript under `apps/server/evals/`, executed with `tsx`, assertions and reporting in plain code, optional Jest wrapper for CI. Rationale: reuses the graph, tools, fixtures and Zod schemas directly (no re-implementation of the state seed), no new framework per ARCHITECTURE guardrails.
- Rejected as **required** tooling: promptfoo (would need a custom provider to drive a LangGraph with seeded state; the assertion model is the same as ours), LangSmith datasets/evaluators (vendor + cost; can be added as a sink later without changing case files), Braintrust/Langfuse (same reasoning). Any of them can consume our JSONL cases and reports if the owner wants a UI.
- Judge output and case files are JSON/JSONL in git; reports are Markdown in `evals/reports/` (committed by the nightly job).

---

## 10. Definition of done for the framework

- AC-1381 Each phase has ≥30 L1 cases and ≥5 L3 scenarios; baselines exist for the current prompt versions.
- AC-1382 A deliberate regression (e.g. delete the "never claim logged" rule from the training prompt) fails the PR gate on `training/no-false-confirmation`.
- AC-1383 Judge calibration ρ ≥ 0.7 on all phases with the pinned judge; calibration file committed.
- AC-1384 The owner can answer "did last week's prompt change help?" from `evals/reports/` alone, without reading code.
