# Model Instruction Inventory — directives outside the prompt files (2026-10-05)

Working document (not a durable spec). Owner rule 2026-10-05: every instruction the coach model receives must be
deliberate and traceable — "otherwise we will not know what we told it and why it came up with this or that". This
inventory lists every place **outside the versioned prompt bodies** (`infra/ai/prompts/phases/**`, `prompts/directives/v*.ts`)
where code tells the model how to act, as opposed to stating a fact. Snapshot of `dev` at `0133e654` (read-only sweep,
2026-10-05); line numbers ±few lines. Paths relative to `apps/server/src/`.

No item here is changed by this document. Any change goes through `prompt-doctor` (`.claude/agents/prompt-doctor.md`):
cause in the exact request first, baseline-vs-candidate eval with guard cases, one class at a time.

Already removed on `plan/plan-and-tool-fixes`: `search_exercises` "Try a broader query or remove filters." (T2) and
`log_set` "Weight … carried over from set N — correct it if different." (T5).

## 1. Tool replies

| file:line | reply kind | text (trimmed) | tells the model to |
|---|---|---|---|
| `infra/ai/tools/save-workout-plan.tool.ts:163` | ok | `Plan saved. Now write a brief confirmation to the user in their language — congratulate them and say you are ready to start training.` | close with congratulation + readiness |
| `infra/ai/tools/save-workout-plan.tool.ts:164` | ok (advisory) | `Plan saved.\n${advisory}\nThen write a brief confirmation to the user in their language.` | address the advisory, then confirm |
| `infra/ai/tools/start-training-session.tool.ts:129` | ok | `Now write a brief energetic message to the user in their language — confirm the session started and motivate them for the workout.` | energetic, motivating close |
| `infra/ai/tools/request-transition.tool.ts:66` | ok | `Transition to ${toPhase} registered. Write a brief closing message to the user in their language.` | write a closing message |
| `infra/ai/graph/handoff.ts:33` | ok (hand-off) | `Transition registered; the next phase answers the user.` | implicitly: do not reply |
| `infra/ai/tools/set-session-place.tool.ts:40` | ok | `Place recorded for this session: ${place}. Acknowledge it briefly in the user's language.` | acknowledge briefly |
| `infra/ai/tools/log-set.tool.ts:186`, `update-last-set.tool.ts:73` | systemError | `Could not save … — a database error occurred. Try again.` | retry — never possible: the executor ends the run on any system error |
| `infra/ai/tools/exercise-name-check.ts:149-151` | llmError | `… Fix the id via search_exercises, or use the English catalog name.` | re-search, retry |
| `infra/ai/tools/save-workout-plan.tool.ts:115`, `start-training-session.tool.ts:76` | llmError | `Invalid exerciseId(s): … Use search_exercises to find valid exercise IDs[, then retry].` | search, retry |
| `infra/ai/tools/get-exercise-history.tool.ts:63` | llmError | `Call search_exercises to find the correct exercise, then retry with its exerciseId.` | search, retry |
| `infra/ai/tools/manage-fact.tool.ts:87,165,175` | llmError | `… Call list_facts and use the exact id.` | call `list_facts` first |
| `infra/ai/tools/manage-fact.tool.ts:95` | llmError | `Several active facts match "…" — call again with the right factId:` | re-call with an id |
| `infra/ai/tools/manage-fact.tool.ts:145-146` | llmError | `Not saved: "permanent" needs … Ask the user whether the condition is truly irreversible; if it is recovery-shaped, use durability "long_term" with reviewInDays instead.` | ask the user or downgrade durability |
| `infra/ai/tools/manage-fact.tool.ts:167,177` | ok | `Fact archived (kept in history, never used or asked about again)…` / `Fact deleted (it will not be used, asked about or shown again)…` | implies: never raise it again |
| `infra/ai/tools/set-preconditions.ts:24` | userError | `If the user reports a set, log it with log_set; otherwise ask what they mean.` | log or ask |
| `infra/ai/tools/complete-registration.tool.ts:46` | userError | `Cannot complete registration — still missing: …. Please collect these fields first.` | collect fields |
| `complete-registration.tool.ts:31`, `save-profile-fields.tool.ts:33,46`, `set-language.tool.ts:31`, `timezone.tool.ts:26,30`, `update-profile.tool.ts:28,33`, `manage-fact.tool.ts:108`, `list-facts.tool.ts:66`, `start-training-session.tool.ts:61,149`, `save-workout-plan.tool.ts:100` | userError | `… Please try again.` / `Please provide …` | retry / supply arguments |
| `domain/user/services/fact-conflicts.ts:76,81` (via `infra/ai/tools/fact-constraint-guard.ts:53`) | userError | `Cannot proceed: "X" primarily trains the <muscle>, but the user has a physical constraint… Remove or replace that exercise and explain the substitution to the user.` | substitute and explain |
| `domain/user/services/fact-conflicts.ts:104-106` | ok (appended advisory) | `ADVISORY — saved, but … You must address this in your reply: tell the user, and ask whether it is still an issue or offer a replacement. The user's word decides.` | raise the conflict, ask/offer |
| `infra/ai/graph/tool-policy.ts:128-132` | llmError | `Duplicate … calls detected… add a unique order field to each call (order=1, order=2)…` | add `order` / send one call |
| `infra/ai/graph/tool-executor.ts:~200,~201` | retry hint | `Fix the arguments and call ${tool} again: …` | fix field, re-call |

## 2. Tool descriptions and `.describe()` (behavioural parts)

| file:line | text (trimmed) | rule |
|---|---|---|
| `infra/ai/tools/complete-current-exercise.tool.ts:55-57` | `Call ONLY when the user explicitly says they are done… Do NOT call automatically after the planned number of sets` | gate on user intent |
| `infra/ai/tools/complete-registration.tool.ts:18-20` | `Call this ONLY when all 6 profile fields are collected AND the user has explicitly confirmed…` | gate + target phase |
| `infra/ai/tools/finish-training.tool.ts:72-73` | `Do NOT call before explicit user confirmation…` | gate |
| `infra/ai/tools/get-exercise-history.tool.ts:30-37` | `… never tell the user they never did the exercise; say it is not in the records.` | when to use + empty-result wording |
| `infra/ai/tools/list-facts.tool.ts:90-93` | `copy that id VERBATIM… quote the fact's said: «…» part EXACTLY… never reconstruct or invent a quote.` | verbatim ids/quotes |
| `infra/ai/tools/manage-fact.tool.ts:34-39,211` | durability policy; `If it is unclear whether the user means retract or delete, just pick the closer one… so do not ask…`; `Never tell the user a fact was retracted… unless the tool call succeeded.` | durability, no-ask, honest outcome |
| `infra/ai/tools/request-transition.tool.ts:16-26` | routing rules; `Do NOT call this for casual fitness questions` | phase routing |
| `infra/ai/tools/save-workout-plan.tool.ts:88-90` | `Call this ONLY when the user has explicitly approved the complete plan.` | gate |
| `infra/ai/tools/start-training-session.tool.ts:36-41` | `… Pass place ONLY if the user named the place themselves — never ask and never guess.` | gate; never ask the place |
| `infra/ai/tools/set-session-place.tool.ts:51-53` | `Do NOT bring this up on your own.` | never ask the place |
| `infra/ai/tools/set-language.tool.ts:40-43` | `Never call it just because the user wrote this particular message in a different language…` | language follows profile |
| `infra/ai/tools/search-exercises.tool.ts:46-51` | English query; may call several times; `always use these exact IDs` | search policy |
| `infra/ai/tools/log-set.tool.ts:198-206` | `never invent or guess a UUID… isometric → durationSeconds… if unknown, log without it and ask the user… Pass setKind 'warmup' ONLY when the user's own words say so… never infer warm-up from a light weight alone.` | field mapping; ask for cardio time |
| `infra/ai/tools/log-set.tool.ts:216,222,248,263-265,270` | `Never invent one.` / `Do NOT use for strength exercises.` / `the coach assumes the weight is per hand. Pass 'total' only when the user explicitly states…` | field constraints; per-hand default |
| `infra/ai/tools/log-set.tool.ts:254-256` + `infra/ai/prompts/effort.ts:8` (BR-TRAINING-044) | `RPE … maps from their plain answer… (0 → 10, 1–2 → 8, 3+ → 7).` | fixed RPE mapping |
| `delete-last-sets.tool.ts:61`, `update-last-set.tool.ts:82-83`, `timezone.tool.ts:41-42`, `update-profile.tool.ts:15-17`, `save-profile-fields.tool.ts:21` | `Use this when…` / `Only include fields the user actually mentioned.` | when to use; no inferred fields |

## 3. Nudges injected by the graph

| file:line | text | effect |
|---|---|---|
| `infra/ai/prompts/blocks/post-tool-nudge.v1.ts:13`, applied in `infra/ai/graph/nodes/agent.node.ts:~124-137` and on the empty-reply retry `:~322` | `IMPORTANT: All tool calls are complete. You MUST now write a natural text response to the user. Do NOT call any more tools.` | forces a text reply; no follow-up tool call in the same run |

## 4. Context blocks with directives

| file:line | text | tells the model to |
|---|---|---|
| `infra/ai/prompts/blocks/course-directive.v1.ts:34,38,41,45,50` | `Constraints in force:` / `Ask now (once, before or during your reply):` + LLM-generated questions / `Possibly stale facts — verify before relying on them:` / `Exercise verdicts:` / `Precedence: the user's message … always outranks this directive` | obey constraints, ask generated questions, verify facts, follow verdicts |
| `infra/ai/prompts/blocks/time-gap.v1.ts:36` | `Reply to their new message first; the earlier conversation is context, not an agenda.` | answer the new message first |
| `infra/ai/prompts/blocks/training-facts.ts:549` | `Check-in: ask how the ${group} is today — not asked yet today.` | ask about a constrained group |
| `infra/ai/prompts/blocks/training-facts.ts:511` | `… a set logged now is dated to the session's last activity.` | mostly fact |
| `infra/ai/prompts/blocks/chat-context.v1.ts:53` | `User DOES NOT have a workout plan yet. Suggest creating one when appropriate.` | suggest a plan |
| `infra/ai/prompts/blocks/session-planning-active-plan.v1.ts:56`, `v2.ts:21` | `No active workout plan. The user should create a plan first (use chat to navigate to plan creation).` | redirect to plan creation |
| `infra/ai/prompts/blocks/episode-summaries.v2.ts:82` | `Context only. Numbers below are not authoritative — use tools and the current state.` | distrust summary numbers |
| `infra/ai/prompts/blocks/session-planning-recovery-timeline.v1.ts:~173` | `may still be sore` / `likely recovered` | interpretive labels (2-day threshold) |

## Strongest silent steers (sweep's judgement)

1. Fact-conflict advisory / refusal (`fact-conflicts.ts:76,81,104-106`) — overrides the scripted confirmation; rule not in any phase prompt.
2. Post-tool nudge — no tool chaining after a tool round; re-sent on the empty-reply retry.
3. Scripted closings in `save_workout_plan`, `start_training_session`, `request_transition`, `set_session_place` — set tone and length.
4. Course Directive block — questions written by a separate model call, rendered as "Ask now".
5. Policies inside `manage_fact`, `list_facts`, `set_language`, `log_set` descriptions (no-ask on retract/delete, verbatim quotes, language from profile, warm-up only from the user's words, RPE mapping, per-hand default); plus the `Check-in` line in `training-facts.ts`.

Inconsistency: "Try again." on `systemError` replies is unreachable — `tool-executor.ts` stops the run on a system error and
replaces the reply with the `tool_system_error` catalog text.

## Proposed handling (owner to decide)

One class at a time through `prompt-doctor`: tool replies → facts only; behavioural rules that the baseline proves
necessary → one visible list in the phase prompt (new prompt version, BR-LLM-008); the rest removed. Suggested order by
risk: scripted closings (1) → "Try again"/retry hints (2) → fact-conflict advisory (3) → post-tool nudge (4, a loop
guard — needs its own decision) → tool-description policies (5).
