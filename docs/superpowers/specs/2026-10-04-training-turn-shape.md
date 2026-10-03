> Implementation spec for I1 Tasks 6a/6b of `docs/superpowers/plans/coach-simplification-i1.md` (committed copy of the gitignored `data/coach-simplification/i0/final-shape.md`; all numbers are invented; local file references below are gitignored evidence, not part of the spec).

# Final shape of a training turn — implementation spec (I0 result, 2026-10-03)

Prompt frozen by D13 (round-9 text). Measured over six full-session replays (3× `--effort low`, 3× default):
9.7 rubric-v2 faults per 21-turn session on average (range 8–11), no arithmetic errors. See `session/factcheck.run10.md`;
owner comments in `owner-comments-run3a.md`. Reference implementation of the rendering: `session/run.py`. Examples below use
invented numbers.

A training turn = **system** (the prompt below) + **one user message** built of five sections, in this order:
`# Profile`, `# Today`, `# History (before today)`, `# This workout so far`, `# Client's message now [HH:MM]`.
In the app, "This workout so far" is the real message list of this workout (no summaries); tools are given by
their schemas only.

## 1. System prompt (verbatim, 2497 characters, budget 2 500) — frozen (D13)

```
You are the client's personal strength coach and training buddy, in Telegram while they train. You answer in Russian like a coach who knows them well: warm, encouraging, direct, brief. Usually two to five short sentences; a list only for a recap.

Each message gives their profile, today's plan with every set logged so far, their recent history per exercise (dates, loads used, how it moved) and habits, and this workout's conversation. That is all you know: never invent a number or fact, nor ask what these show.

How you coach:
- At the start, give a short strategy for today, not every set ahead: what to try on the first set, keeping a couple of reps in reserve, and judge the rest from how it goes. Warm-up in one phrase, in line with their habit; a warm-up set is light, 7–8 reps.
- Offer the next set as a try, never a demand: an optimistic, reachable number with an easy way out, like «Попробуй до 15, но не до отказа; если 12 хватило — не гонись». When last time topped the rep range with reps to spare, the try is the next load they have used; otherwise a rep or two more. For high-rep and burn sets: «сколько сможешь, до жжения».
- The client leads: when they add, swap or skip something, go with it and help, within the limits in their profile. Every planned set gets done unless they or pain say otherwise.
- Keep your line; change it only when something new happened, and say what. Your conditions count: «135, если останется запас» and reps were left means 135.
- After a set, confirm it as today's log shows it (never from memory of the chat), then the next step. Praise earned progress briefly, with both numbers; call a real jump a jump, and do not sell a rep or two as a new height. Compare like with like. A drop set or finisher gets a one-line verdict.
- Answer exactly what was asked; a recap request gets only the recap.
- If something hurts (not the usual burn), they stop that exercise; offer a safe alternative or finishing, and remember a new limit for next time (manage_fact).

Talk like a person, not a program: you suggest, you never "asked" or "change the plan"; no records, logs, systems, rules or conditions behind your words. Say RPE only if the client does. Technique cues only when concrete.

Emoji mark a special moment: a new best, a hard set done, a good finish. Use them with care, never in every message, as a professional would.

Your tools save reported sets. Format: Telegram HTML, <b> for key numbers, <i> sparingly; no Markdown, tables or headings.
```

Limits: the coach works within the limits in the profile, asks about them once at the start (Today check-in line),
and remembers a newly reported pain or limit via `manage_fact`.

Style (owner, `owner-comments-run3a.md`): a warm, encouraging buddy-coach. The coach offers and never presses,
praises earned progress briefly with both numbers, and answers exactly what was asked. **Emoji:** the separate
emoji line above. Use them sparingly, at a new best, a hard set done or the end of a workout, never on a plain
confirmation and never in every message (target about a quarter to a half of replies; no 😉).

## 2. Profile — rendering rules

- Heading `# Profile`, at most 6 bullet lines, only what the coach needs during a set:
  1. name, training level, language;
  2. physical constraints as **constraints only** (what to avoid), never symptom wording;
  3. equipment / style preferences that matter when the client swaps or adds an exercise;
  4. how the client reports effort (e.g. RPE himself);
  5. per-machine notes that change how numbers read (e.g. a sled's own weight).
- One source per fact: a fact that is in History or Today is not repeated here.

Example:
```
# Profile
- alex, intermediate; speaks Russian.
- Knees: no deep loaded knee flexion (full-depth squat, sissy squat).
- Prefers machines and cables; for core, short endurance holds rather than loaded work.
- Reports effort as RPE himself.
- Hack squat: the carriage's own weight (unknown) adds to the plates.
```

## 3. Today — rendering rules

- `# Today`, then `Now: <Weekday> <Mon D>, HH:MM.` (current time only — no session start, no elapsed minutes).
- `Plan: <Exercise> <sets×reps or ×time> · …` exactly as planned (no loads).
- `Logged so far:` one line per exercise in this order: today's cardio warm-up (if logged), every planned exercise
  (`nothing yet` when empty), then off-plan exercises added mid-session.
- Strength set = `reps×kg`; isometric = `45 s` (`each side` when per side); cardio = `<N> min (warm-up)`.
- **Effort rule:** effort appears only when the client stated it, in his terms — `(RPE 8)`, `(2–3 reps left, his
  words)`, `(to failure)`. Nothing is inferred or defaulted; a set without stated effort is printed bare.
- Off-plan exercise: `- <Name> (added, kg per hand): …` — the unit note only when it changes how numbers read.
- **Check-in line (D12)** — exact text, right after the Plan line:
  `Check-in: ask how the lower back is today — not asked yet today.`
  Rendered **only on the first training turn** (no coach reply in this workout yet). It is omitted on every later turn,
  and omitted on the first turn too when the planner's warnings/notes for this session already cover the limit
  (in the app the planner usually asked). The limit name comes from the profile's constraint line.
- **Reported-today line (D13)** — one line per pain or new limit reported during this session, from the facts the
  coach created in this session (`manage_fact`). It is rendered right after the Plan / check-in lines, from the turn
  after the report (the fact is created while the coach answers the report):
  `Reported today: <what, where, when it happened> (<HH:MM>).` — e.g.
  `Reported today: a pinch in the right knee on the last calf set (19:33).`
  Measured: it does not by itself stop the coach asking about the pain again (re-asks in 6/6 runs). A later fix
  could add «— already discussed» once the coach has answered it.

Example (strength, isometric, cardio, off-plan added mid-session, a pain reported earlier today):
```
# Today
Now: Tuesday Mar 10, 19:05.
Plan: Hack Squat 4×10 · Seated Leg Curl 3×12 · Plank 2×40 s · Side Plank 2×20–25 s per side.
Reported today: a twinge in the left shoulder on the second lateral raise (18:58).
Logged so far:
- Treadmill 12 min (warm-up)
- Hack Squat 4×10: 10×80 (RPE 7), 10×85 (2 reps left, his words), 10×85, 13×85 (to failure)
- Seated Leg Curl 3×12: nothing yet
- Plank 2×40 s: 40 s, 40 s
- Side Plank 2×20–25 s per side: 25 s each side
- Cable Lateral Raise (added, kg per side): 15×5 (RPE 9)
```

## 4. History (before today) — rendering rules

- Heading `# History (before today)`.
- **Habit line first**, computed from the last 10 workouts with at least two exercises:
  `Habit: a cardio warm-up (<kind> <min>–<max> min, …) before <k> of the last <n> workouts.` Shown only when k ≥ half
  of n. It replaces any history block for the warm-up cardio itself.
- **One block per exercise** of today's plan; an off-plan exercise gets its block from the first turn it is logged.
  Header: `<Name> (today <target>)`, or `<Name> (not in today's plan; <unit note>; only N earlier records)`.
- Up to **three last performances**, newest first: `- <N> days ago, <Weekday> <Mon D>: <sets>`; an old one
  `- <Weekday> <Mon D>, about <N> months ago: …`. Sets as in Today; client notes in his words after ` — his note: `.
- **Effort marks:** `(RPE x)` on the sets that have it; `(all RPE x)` when all equal; a strength line with no
  effort at all ends with `(no RPE recorded)`. Isometric lines carry no effort mark.
- **Set kinds:** `(warm-up)`, `(drop set)`, `(finisher)` only when the stored set carries that kind; legacy sets
  without a kind are never labelled, even when the first set looks light.
- **Trend line:** `- Trend <date> → <date> → <date>: <heaviest weight / reps / weight × reps> …` (plain values, no verdict).
- **Loads-used line** (strength only): distinct loads ever used on this exercise; those used within the last 60 days
  ascending, older ones grouped with their last date: `- Loads used: 50, 57, 64 kg; 71 kg last on Jan 12.`

Examples:
```
# History (before today)

Habit: a cardio warm-up (treadmill 10–15 min, bike 8 min) before 9 of the last 10 workouts.

Hack Squat (today 4×10)
- 3 days ago, Saturday Mar 7: 10×70, 10×80 (RPE 8), 10×80 (RPE 8), 10×85 (RPE 9)
- 8 days ago, Monday Mar 2: 10×70, 10×75, 10×75 (no RPE recorded)
- 14 days ago, Tuesday Feb 24: 10×65, 10×70, 10×70 (all RPE 7)
- Trend Feb 24 → Mar 2 → Mar 7: heaviest weight 70 → 75 → 85 kg; weight × reps 2,050 → 2,200 → 3,150.
- Loads used: 60, 65, 70, 75, 80, 85 kg; 90 kg last on Nov 18.

Plank (today 2×40 s)
- 3 days ago, Saturday Mar 7: 40 s, 40 s
- 8 days ago, Monday Mar 2: 35 s, 40 s
- Trend Mar 2 → Mar 7: 35–40 → 40 s.

Cable Lateral Raise (not in today's plan; kg per side; only two earlier records)
- 9 days ago, Sunday Mar 1: 15×5, 12×5 (RPE 8), 10×2.5 (drop set)
- 20 days ago, Wednesday Feb 18: 12×5, 12×5 (no RPE recorded)
- Trend Feb 18 → Mar 1: reps at 5 kg 24 → 27.
- Loads used: 2.5, 5 kg.
```

## 5. This workout so far / current message

```
# This workout so far
[19:02] Client: начал, 12 минут дорожка
[19:02] Coach: <the coach's own earlier reply, verbatim>

# Client's message now [19:05]
85 на 13 до отказа
```
Empty conversation → `(nothing yet)`. Times are message times (the client's local time).

## 6. Deliberately NOT shown

- session length / duration budget and elapsed minutes ("started N min ago") — made the coach cut planned sets;
- training goal, split, sessions per week, age, height, body weight — planning facts, not needed mid-set;
- symptom wording of a constraint ("dull heaviness, no acute pain") — made the coach ask about the back every turn;
- conversation summaries, course/phase directives, decision or ladder output, instruction tails in tool results;
- messages of previous workouts (only this workout's messages);
- warm-up labels the stored data does not carry; a separate history block for the habitual cardio warm-up.

## 7. Diffs

From `coach-prompt.v1.md` (2 337 chars → 2497):
- coach is also a "training buddy"; tone adds "encouraging";
- the input description adds "loads used" and "habits";
- "ask only what the facts don't show" merged into the no-invention line;
- new start-of-session line: a short strategy for today, first set tried with reps in reserve, the rest judged
  after it; warm-up in one phrase following the habit; a warm-up set is 7–8 light reps;
- the progression line rewritten as "offer as a try, never a demand", with the owner's example «Попробуй до 15, но
  не до отказа; если 12 хватило — не гонись»; topped range with reps to spare → the next used load; burn sets →
  «сколько сможешь, до жжения»;
- new "client leads" line: go with adds/swaps/skips within the back limits; every planned set is done unless the
  client or pain says otherwise;
- "hold one line" now includes the advice's own conditions (the 135 example);
- set confirmation is read from today's log, never from memory of the chat;
- praise line: brief, both numbers, a real jump named as a jump, a rep or two not oversold; drop set / finisher gets
  a one-line verdict;
- new "answer exactly what was asked" line;
- program-speak list adds logs, tools, rules, conditions and "you suggest, you never 'asked' or 'change the plan'";
  reps-in-the-tank fallback dropped; technique cues only when concrete;
- "Respect the profile, the lower back first" folded into the client-leads line, now generic: «within the limits in their profile»;
- pain line adds «…and remember a new limit for next time (manage_fact)»;
- **style — emoji line** (owner, 2026-10-04): «Emoji mark a special moment: a new best, a hard set done, a good finish.
  Use them with care, never in every message, as a professional would.» Measured: 4–9 of 20 replies, all 💪/👍. In
  one run of two, two of them landed on plain confirmations. Without the line, emoji are sampling noise (0–15 of 20
  on the same prompt). A line that only asks for "an emoji now and then" overshoots (20 of 20, with 😉);
- to fit the budget: «talking with them in Telegram» → «in Telegram», «an experienced coach» → «a coach».

From the run-1 input shape:
- Profile: 9 lines → 5 (removed age/height/weight, goal, session length, split/frequency, back symptom wording);
- Today: "Session started at HH:MM (N min ago)" removed; first-turn check-in line added (D12); «Reported today» line added (D13);
- History: habit line added; loads-used line per strength exercise added; "(no RPE recorded)" added; unbacked
  "(warm-up)" label removed; the one-record cycling block removed;
- conversation unchanged in form (verbatim coach replies, as in run 1 — the I0 single-turn cases used summaries).
