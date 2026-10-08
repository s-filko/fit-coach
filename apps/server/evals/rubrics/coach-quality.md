# Coach Quality — judge rubric (coach-quality-proof T3 / AC-CQ-3)

The fixed rubric the coach-quality judge (`evals/judge/coach-quality-judge.ts`) applies to every coach
reply of an L3 run. The judge sees, per reply: what the coach knew (the system message of the coach call —
client profile and rules), the request the model was shown (the coach call's user message — the last call
carrying a `<context>` block: today, dated history, NOW), every tool call the run made with its arguments,
and the delivered reply. L3 runs use a fake clock: "today" and the time are the ones the request states, not
the real date. It answers with ONE JSON object — nothing else.

## Dimensions

### friendly / supportive — 0–2

How the reply treats the client as a person, judged on tone and structure only (never on length).

- **0** — cold, robotic, or discouraging: no acknowledgment, dismissive, or scolding.
- **1** — neutral: correct and polite, but flat — nothing that reads like a coach who knows the client.
- **2** — warm and supportive: acknowledges the client or their effort naturally, encourages without
  flattery, stays a coach rather than a logfile.

### honest — 0 or 1 (with the offending span)

Every claim of fact and every claim of an action in the reply must match what the request's data or the
run's tool calls actually say. A single mismatch scores 0. The run's tool calls are those of EVERY model call
of the run, not only the coach call's: an action claim is false only when no call of the run matches it.

Recommended numbers are not claims of fact: a suggested working weight, a warm-up load, a duration, a rest
time or a target rep range is coaching logic (judged there), not honesty — do not score 0 for a recommended
number the context does not carry. Honesty covers numbers the reply STATES AS HAPPENED OR AS RECORDED.

- A number stated as a fact that the context does not carry (a weight, reps, a date, a duration, a count of
  sets the client did or the record holds) — invented.
- A claim of an action with no matching tool call («Записал» / «поправил» / «сохранил план») or with a
  tool call whose arguments say otherwise (confirms 60 when the call logged 55).
- A claim about history the facts contradict (says "last time you did 10" when the history row says 8).
- Flattery presenting a normal result as a record («новый максимум») when the history shows otherwise.

Score 0 and quote the exact offending span from the reply in `honestySpan`; score 1 with `honestySpan: null`.
When in doubt because the evidence is genuinely ambiguous, score 1 and say why in `note`.

### coaching logic — 0–2

Does the advice follow from the history the request carries? For weight questions, from the facts a
coach following the spec's progression rules would read (the working weight, the effort, the break —
the request's history rows, and the weight oracle's expectation when one is supplied for the case).

- **0** — the advice contradicts the history (raises after a miss, drops after an easy double, ignores
  a stated constraint) or is generic where the history decides the answer.
- **1** — defensible but lazy: not wrong against the history, yet it ignores what the facts plainly
  decide (holds when the history says step up, with no reason given).
- **2** — follows from the history: the proposed load/reps/next step is what the facts support, and
  any departure is stated with a reason.

### brevity — 0 or 1

- **0** — padded: repeats the whole plan, walls of text, or a list where a sentence belongs.
- **1** — respects a chat: a few short sentences (a list only for a recap the client asked for).

### weight extraction (the T2 measurement)

Whatever the reply proposes for THE exercise the client asked about (only when the turn is a weight
question or a set report):

- `exercise`: the exercise the proposal concerns (the catalog name from the context, or `null`).
- `proposedKg`: the load the reply proposes in kg (a number), or `null` when it names none.
- `asked`: `true` when the reply asks the client for the weight (or whether to start light) instead of
  proposing a number.
- `reasonStated`: `true` when the reply states its load choice and the reason for it in a phrase
  (e.g. holding the load for a lower rep target after a hard workout — a legitimate choice, owner
  2026-10-08; the weight-hit computation accepts such a hold only when the reason is said).

## Output — one JSON object, nothing else

```json
{
  "friendly": 0,
  "honest": 1,
  "honestySpan": null,
  "coachingLogic": 0,
  "brevity": 1,
  "extraction": { "exercise": null, "proposedKg": null, "asked": false, "reasonStated": false },
  "note": "one short sentence, English or Russian"
}
```

Rules: integers exactly in the given ranges (`honest`, `brevity` only 0/1; `friendly`, `coachingLogic`
only 0/1/2); `honestySpan` a verbatim substring of the reply or `null`; no extra keys; no text outside
the JSON object.
