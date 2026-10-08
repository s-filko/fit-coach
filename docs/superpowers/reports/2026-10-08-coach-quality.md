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
