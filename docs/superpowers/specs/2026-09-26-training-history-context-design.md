# Design — Training history in the agent's context (draft)

> **Status: draft from the 2026-09-26 owner discussion.** Not planned, not approved for
> implementation. Decisions are marked **[owner]** (stated or confirmed by the owner) or
> **[proposed]** (the orchestrator's proposal, not yet confirmed). Related:
> `2026-09-24-load-advisor-design.md` (progression analytics and strategy memory build on
> this history), `2026-09-24-coach-roadmap.md`.

## 1. Problem [owner]

A plain Claude chat used as a coach over five consecutive workouts answers better than the
Fit Coach agent, because the chat holds the whole raw history while the agent sees curated
per-phase slices. Every missed slice costs a code change (e.g. `get_exercise_history`, capped
at one exercise and 5 performances). The owner's principle: **give a capable agent access and
a readable format, and let it decide what it needs** — instead of pre-programming the slice.

## 2. Principle [owner]

- **Reads are broad, writes are narrow.** Read tools are safe: the only hard limit is that a
  user sees only their own data (`userId` from the run config, never from tool args). Write
  tools keep their invariants (ordering, batch dedup, error budget).
- Limit the **size of a result**, not **what may be asked**: an oversized result returns a
  summary plus "N more — narrow the filter"; an empty result carries a hint (the nearest
  record's date) so no second call is needed to widen the window.

## 3. The history block — always injected [owner]

**Injected in every post-registration phase** [owner 2026-09-26] — chat, plan creation,
session planning and training alike (a user with no workouts yet gets "No workouts yet").
**Not in registration** [owner]: a user there has no history — `profileStatus` becomes
`complete` only via `complete_registration`, and no code path resets it (the fallback in
`prepare.node.ts` returns to registration only if the status were reset by hand). Today the
answer depends on where the question is asked: chat shows the last 5 workouts without weights
and has no history tool; plan creation has no training history at all; session planning shows
the last 5 workouts and no tool; only training has the per-exercise history and
`get_exercise_history`.

One block replaces today's overlapping history slices (`EXERCISE HISTORY`, `RECENT WORKOUTS`,
`session-planning-recent-history`, `session-planning-recovery-timeline`) — several views with
different formats and windows are themselves a source of confusion. The current in-progress
session stays separate.

```
TRAINING HISTORY
All time: 26 workouts since 2026-06-14.
Per month: Jun 4 · Jul 7 · Aug 6 · Sep 9
Last 10 workouts: 2026-09-10 … 2026-09-25 — 16 days, ≈4.4 per week.
Last trained (primary muscle): chest 09-25 · triceps 09-25 · quads 09-21 · …

2026-09-10 | Cable Tricep Pushdown, Rope [triceps:primary] 45×10 | 45×8 | 38×9
…
2026-09-25 | Machine Chest Press [chest:primary, triceps:secondary] 60×12 | 65×10 ×2
Older workouts are not shown in detail — use get_training_history.
```

- **Detail window = the last 10 workouts** (a constant, raise to 15 if too few) — by count,
  not by days: predictable size (≈165 tokens/workout on the owner's data → ≈1.7k tokens),
  every split day appears 3–4 times, never empty except for a new user ("No workouts yet").
- **Frequency is explicit** [owner]: the span and per-week rate of the last 10 workouts (the
  current rhythm) and the per-month counts (the dynamics — regular, lapsed, returning).
  Ten workouts may be two weeks for one user and three months for another.
- **All-time summary** [owner]: total, first date. **Last trained per primary muscle**
  [proposed, agreed]: answers "when did I last train X" without a tool call.
- Each exercise line carries its muscles with `primary`/`secondary` from
  `exercise_muscle_groups` (already in the catalog).

## 4. Prompt caching [owner concern; mechanics proposed]

Provider prompt caching is prefix-based: everything after the first changed token is
recomputed.

- **Finding (today):** the `NOW` line is the last section of block 1 (`current-time.v1.ts`),
  but facts, summaries, domain blocks and the whole episode history come after it — so
  nothing past the static phase prompt is ever cached. Relative dates ("3 days ago", "5d
  ago") in summaries and blocks add a daily break. `cached_tokens` is not recorded anywhere,
  so this is unmeasured.
- **Target order:** static phase prompt → history block → facts, episode summaries →
  episode messages → current session, `NOW`, anything relative to today.
- History block: **absolute dates only**, **oldest → newest** (a new workout appends; the
  prefix above stays cached). It changes only when a workout completes.
- Compaction: replaces old turns with a summary below the history block — one full recompute,
  then cached again. Inactivity compaction happens after the cache TTL has expired anyway;
  budget compaction is rare by the low-water mark. Phase switches change block 1 — a full
  miss; out of scope here.
- **First step — cost accounting with cache visibility** [owner 2026-09-26: cache usage must
  be visible in the stats, as the basis for future optimisation]:
  1. Record each call's full provider usage — input, output, **cached input**, reasoning
     tokens (and the provider-reported cost, if the route returns one — probe first) — on
     `llm_calls`, rolled up per run on `conversation_runs`. Today only
     `promptTokens`/`completionTokens` are read (`run-metrics.ts`, `llm-log-handler.ts`,
     `agent.node.ts`) and `llm_calls.response` keeps only the reply text, so the cache share
     cannot be reconstructed after the fact.
  2. Link a run to the workout session it happened in (`session_id` on `conversation_runs`)
     — today a per-workout total is only a time-window join.
  3. A "cost per workout" report over those fields (tokens, cache share; money from a price
     table only if needed).
  4. **Cache-miss attribution** [owner 2026-09-26: a miss caused by the cache TTL, while
     everything else was right, must be distinguishable]. Each call gets an *expected* cache
     state computed before the response, by comparing it with the same user's previous call
     (`llm_calls` already keeps the call time and the ordered hashes of every system message,
     `prompt_hashes`, plus the non-system messages in `request`):
     `cold` (no previous call) · `ttl_expired` (same prefix, gap > the provider's TTL) ·
     `prefix_changed:<where>` (first diverging part — phase prompt/version, tool set, facts,
     summaries after compaction, history block, `NOW`) · `too_short` (shared prefix below the
     provider's minimum) · `warm` (the cache should hit). After the response it is compared
     with the actual cached tokens; **`warm` with no cache hit is an unexplained miss** — the
     actionable signal (a wrong assumption about the provider's rules, or best-effort
     caching). TTL and minimum size are per-provider settings taken from provider docs, never
     guessed in code. Use case: how many misses the rest pauses between sets cause.
  Baseline without it (2026-09-26, dev, owner's workout 2026-09-25, `glm-5.3-flash`): 69 runs,
  90 calls, 1 302 759 input / 13 615 output tokens; ~18.9k input per run (system ~3.5k,
  history ~8k, blocks ~0.9k, facts+summaries ~1.1k, tool schemas etc. ~5k). Input is ~99 % of
  the volume, which is why the cache share is the lever. Provider caching behaviour (Z.AI GLM, Gemini via OpenRouter: minimum size, TTL,
  effect on subscription quota) must be read from provider docs and probed before relying on
  it.

## 5. The history tool — `get_training_history` [owner]

Generalises `get_exercise_history`. Optional filters the model combines itself: exercise(s),
muscle (with involvement), date range, last N workouts; detail level (summary / all sets).
Returns **the same line format as the block**. Available in every
post-registration phase [owner 2026-09-26], not only `training`. Prompt rule: answer from the block when it covers the
question; call the tool only for what lies outside it.

The tool answers **"what was done"** (the raw log). **"How is it going / what weight to take"**
(trend, plateau, strategy) is the load advisor's job — a separate tool with computed
analytics, see `2026-09-24-load-advisor-design.md`. Not merged into one tool with a mode flag.

## 6. Measurements (2026-09-26, dev, owner's account)

26 completed workouts, 140 exercise entries. Raw rows with JSON sets ≈ 38k chars (≈11k
tokens); compact line format ≈ 15k chars (≈4.3k tokens) for the whole history.

## 7. Open questions

1. Do the phase prompts' existing rules that reference the old blocks (`EXERCISE HISTORY`,
   `RECENT WORKOUTS`) move to the new block verbatim, or are they rewritten.
2. Order vs the load-advisor roadmap: whether this lands before Stage 4 as its data
   foundation (R4.2/R4.3 read the same history).
