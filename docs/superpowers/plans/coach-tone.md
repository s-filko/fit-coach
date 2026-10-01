# Coach Tone — the coach knows the trend and encourages progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and
> test-driven-development. To be detailed before execution.

- Status: planned
- After: load-plan-fixes

**Goal:** during a workout the coach knows each exercise's last two performances and their trend, sets a small
reachable target above the last one, and praises progress — instead of holding loads, restating progression
conditions and framing results as worse than before.

## Found (owner live session 2026-10-01, `lower_a_20261001`, dev, first workout after `load-plan-fixes` + training v12)

Owner's verdict: the coach demotivates — understates results, goals and achievements, miscounts, comments off
the point, compares with the past almost always as "worse", contradicts itself. Evidence from the transcript:

- 130 kg first set done exactly as the coach had advised → «130 кг — это осторожный вариант из плана, так что
  подход засчитан нормально».
- 16 × 135 kg (target 12, best leg-press set on record) → «Вариант „15 повторов один раз“ не подходит, потому что
  усилие было 9.5»; the hold condition restated in 6 messages.
- Leg curl / extension 66 → 72 kg → reported as «объём на 5 % ниже» (kg×reps across different set counts/loads).
- Calves held at 40 kg by the coach's own choice (Sunday 45 kg) → «сегодня на 1500 кг меньше»; the workout's
  last verdict was «общий объём примерно на 5 % ниже».
- «Система советовала 6 кг, но ты взял 10 кг» (biceps); internal terms in replies («система», «LOAD PLAN»,
  «холодный старт», «в базе нет следующего веса»).

Causes found (2026-10-01):

1. EXERCISE HISTORY shows only the last performance; the one before exists only as a tonnage number in the
   LOAD PLAN `volume:` line — the model cannot see a trend (e.g. 10 → 12 reps).
2. The session plan carries fixed reps (`4×12`, `3×15`); the LOAD PLAN reads them as range `12` / `15`, so
   reaching the number is already "at or above top" → hold; there is no "a few reps more" target.
3. Training prompt v12 requires naming the `next step:` condition and explaining a lower load on every load
   comment, with prohibitions (never promise / pressure) and no instruction to recognise progress.
4. Comparisons by kg×reps tonnage read a heavier load with fewer reps, or fewer planned sets, as regression.

## Owner's expectations (2026-10-01) — acceptance basis

- The coach knows the previous workout and the one before it for each exercise, and understands the dynamics
  between them.
- Before an exercise it encourages without pressure, e.g.: «В прошлый раз 12 повторов на RPE 10 с таким-то
  весом. Ты хорошо отдохнул — можем попробовать чуть больше, дотянуть до 15. Не получится — остаёмся на 12.»
- When the owner reaches more (e.g. 15), the coach praises it as progress («прогресс, хорошо идём»).
- The owner's choice among offered options is never framed as second-rate.

## Scope (outline, owner-agreed 2026-10-01; details at planning)

1. Context: the last two performances per exercise + a computed trend fact (more reps at the same load, new
   working load, best set).
2. Rep ranges in session plans (e.g. 12–15) and today's target = 1–3 reps above the last performance,
   fallback = repeat it; load step when the range top is reached.
3. Achievement detection in code (reps up at a load, load up, best set on record); replies lead with it.
4. Comparisons by load and reps at the same load, not tonnage across different plans.
5. Prompt: the progression condition once, at the exercise recap; no internal terms; the owner's choice is
   never "the cautious option"; the workout recap opens with what grew.
6. Progression for a client who trains to RPE 9–10: reserve-gated growth branches must not block growth
   (shared root with `restart-ladder`).
