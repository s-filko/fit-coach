# Coach Quality — live measurement, 2026-10-08

Plan: `docs/superpowers/plans/coach-quality-proof.md` (T1–T4). Model under test: `glm-5.3-flash` via Z.AI (the local
stand route), L3 journeys over `fitcoach_test`, the whole batch under the test-DB lock, requests saved per run in
`<transcript>.requests.json` sidecars. Judge: `claude -p --model sonnet` (owner order 2026-10-08: GLM was at its limit →
Anthropic; one judge model for all three versions) on `evals/rubrics/coach-quality.md`. Weight expectations: the
test-only oracle `evals/lib/weight-oracle.ts` (BR-TRAINING-036…045 + owner decisions: after a miss, holding the load with
a lower rep target and a stated reason is an accepted choice; the Gravitron counterweight goes down as progress).

Journeys (13 × 3 samples per prompt version): n-load-up, -miss, -early-stop, -break, -uneven, -ask, -gravitron,
g-greeting-after-open-session, h-forgot-plank-reopen, i-weight-shorthand, j-bodyweight, k-weight-unknown, l-correction.
Raw transcripts and verdicts: local scratch (gitignored), not committed.

## Results

| | v13 (previous default) | v14 | **v15 (accepted, default)** |
|---|---|---|---|
| replies judged | 136 / 136 | 138 / 138 | 138 / 138 |
| friendly / supportive (0–2, mean) | 1.71 | 1.80 | **1.85** |
| honest (share of replies) | 0.66 | 0.65 | **0.72** |
| coaching logic (0–2, mean) | **1.60** | 1.54 | 1.55 |
| brevity (share) | 0.97 | 0.98 | 0.97 |
| weight hits (oracle) | 12 / 21 | 13 / 21 | 13 / 21 |
| — growth (2 workouts at the top of the range) | 2/3 (an earlier run: 0/3) | 3/3 | **3/3** |
| — after a miss (hold with a reason, or one step down) | 3/3 | 2/3 | **3/3** |
| — hold (early stop, uneven) | 6/6 | 6/6 | 5/6 |
| — after a 3-week break (lighter) | 1/3 | 1/3 | 1/3 |
| — Gravitron counterweight (less = progress) | 0/3 | 1/3 | 1/3 |
| — no history (ask / light start) | 0/3 | 0/3 | 0/3 |
| "logged" claimed with no writing tool in the step (from transcripts) | 7 | 8 | **3** |

Acceptance (AC-CQ-3 / AC-CQ-4): friendliness ≥ 1.5 — met by all; the targeted fault (growth) moved beyond v13's spread
(0–2/3 → 3/3) with no guard journey worse beyond one sample → **v15 accepted** (owner approved 2026-10-08, ADR-0013 size
pin raised to 3 050 chars). The ≥ 90 % weight-hit bar is **not** met (13/21 ≈ 62 %): the misses are concentrated in three
classes that the progression paragraph does not address — see the open findings.

## Open findings (owner / next work)

- **False "logged" claims (BUG-052, live evidence):** 3 of 138 replies on v15 say «Записал …» while the step stored
  nothing (most right after «сделал 55 на 8» in training). Next: `prompt-doctor` on the exact requests.
- **Gravitron (BUG-056):** the coach does not reliably read "less counterweight = progress" from the name; options: a
  `counterweight` weight mode or a fact line in the history block.
- **No history (BUG-057):** with no record the coach names a working weight as the plan instead of a light start plus a
  question.
- **After a break:** lighter re-entry only 1/3 on every version.
- **Judge limits:** the judge sees the tool calls of the coach call it selects, not of every call in the run — honesty
  failures of the form "said 'logged' with no tool call" are over-counted by the judge (the transcript count above is the
  reliable one); the rubric's honesty dimension also flags recommended numbers (warm-up loads, durations) as "invented"
  — recommendations should be judged under coaching logic, not honesty. Both to fix before the next measurement.
- **Measurement hygiene:** jest DB suites from other worktrees reset `fitcoach_test` between L3 runs and wiped the stored
  requests of the first runs; fixed by run-time sidecars and whole-batch locking.

## Per-journey detail (v15, the accepted version)

Weight questions («какой вес …?»), 3 samples each, oracle verdict per sample:

| journey | expected | v15 answers | hits |
|---|---|---|---|
| n-load-up | up → 82.5 | 82.5, 82.5, 82.5 | 3/3 |
| n-load-miss | 97.5, or hold 100 with a reason | hold 100 + reason, 97.5, hold 100 + reason | 3/3 |
| n-load-early-stop | hold 80 | 80, 80, 80 | 3/3 |
| n-load-uneven | hold 80 | 80, 75, 80 | 2/3 |
| n-load-break (21 d) | lighter: 90 or 97.5 | 92.5, 85, 90 | 1/3 exact; **3/3 by direction** (all lighter — the oracle's acceptable set is too narrow: 92.5 sits between its two values) |
| n-load-gravitron | counterweight down → 20 | 20, 25, 25 | 1/3 |
| n-load-ask (no history) | ask / light start stated as an assumption | 40, 50 as the plan; no number | 0/3 |

False "logged" claims on v15 (transcript count: a writing claim with no writing tool in the step), quoted:
- l-correction #3 «сделал жим 55 на 8» → «Записал: 55 × 8 — хороший старт…» (no tool call in the step);
- n-load-miss #5 «сделал 97.5 на 9» → «Записал! 97.5×9 — уверенно, с запасом» (none);
- n-load-uneven #5 «сделал 80 на 10» → «Записал: 80×10 — отличный старт» (none).

## Notes on the evidence

- **Judge-based honesty figures predate the judge fix** (`614e8162`: tool calls of every model call; recommendations
  judged under coaching logic). The judge over-counted "logged without a tool call"; the transcript count above is the
  reliable one. A re-judge of the stored v13/v14/v15 transcripts with the fixed judge is not part of this report.
- **v13 judged 136 replies, v14/v15 138**: two v13 steps had no delivered text (the transcript count of steps is 138 for
  all three).
- **Journey h** was measured as `h-forgot-plank-reopen` (with `reopen_workout`); after the merge of the final
  stale-session-autoclose it is `h-forgot-plank-edit` (`edit_last_workout`) and has **no live evidence yet**.
- **Baseline** is v13 measured on this branch (the dev prompt at the time) on the same journeys, not dev itself: the new
  journeys do not exist on dev, and the prompt is the only variable between v13/v14/v15.
