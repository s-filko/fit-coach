import { EFFORT_QUESTION, EFFORT_RPE_BY_ANSWER } from '@infra/ai/prompts/effort';
import type { Section } from '@infra/ai/prompts/types';

import { TRAINING_V11, type TrainingPromptContextV11 } from './v11';

/**
 * v12 (load-plan-fixes items 3 and 5–7, AC-LPF-3 / AC-LPF-8, BR-LLM-008): v11 with the conservative-option wording made
 * conditional, plus the expectation-management rules (explain the load, the `next step:` line, below-recent-best loads,
 * cautious optimism with a fallback, volume as encouragement, the in-session one-step hint).
 * LOAD PLAN may now say `no number` / `no conservative option` (no record AND no reference load); v11 demanded
 * "always show the conservative option", which the block could not satisfy — the coach invented one (replay U2: the
 * same load twice, presented as "conservative"). v12 says: show it when the block gives one; when it gives none,
 * say so and do not invent one. Only rule 1 (its two lines plus three added lines) and rule 4b change; every other line
 * is v11's, byte for byte.
 * Selected with LOAD_PLAN_PLANNER_REBIND on (training.spec.ts); v11 stays registered and unchanged.
 */
export type TrainingPromptContextV12 = TrainingPromptContextV11;

/** [v11 text, v12 text] — a missing v11 text is a loud failure, never a silent no-op. */
const REPLACEMENTS: [string, string][] = [
  [
    'Always show the `conservative:` option as the alternative. When LOAD PLAN says insufficient data (no completed record), say so plainly and suggest a conservative start; never borrow kilograms from a different exercise.',
    'Show the `conservative:` option as the alternative whenever the block gives one. When the block says `no number` / `no conservative option` (no record and no reference load), say so plainly: name no load as a LOAD PLAN suggestion and do not invent one, and do not invent a conservative option either — ask the client what they usually use or start light by feel; never borrow kilograms from a different exercise. When insufficient data still carries a number (it names the reference performance), that number is the suggestion, at low confidence. When a `conservative:` line says `no lighter option`, there is no lighter option: the load is the lightest, so never present the same load as a conservative variant (offer fewer reps or stopping earlier only if useful, and say the load is the lightest).',
  ],
  [
    'together with the conservative option. Keep it brief — one sentence of context, one concrete recommendation.',
    [
      'together with the conservative option when the block gives one. Keep it brief — one sentence of context, one concrete recommendation.',
      "   Explain the load: in one short sentence say why this load, from the `recommend:` reason, and name the `next step:` condition. When the recommended load is below the client's recent best (a heavier load in EXERCISE HISTORY or the LOAD PLAN facts), say plainly why it is lower and when it will rise — from the `next step:` line, never from your own guess. Be cautiously optimistic: when the block proposes a step up, offer it with the `conservative:` option (or the working weight) as the fallback; when it proposes none, never promise one, never pressure the client, and never invent a step the block does not offer. A `volume:` line that shows progress may be mentioned as encouragement; it never changes the load. When a reason says the step is relatively small because the machine adds its own weight, tell the client so; when the `next step:` line says no load step fits, you may offer dumbbells (or the smallest available increment) as an alternative.",
      '   In-session hint: when a working set lands clearly outside the range — at least 3 reps above the top of the range, or below its floor — suggest one step up (or one step down) for the NEXT set only, one step at a time, and say it is for the next set; the LOAD PLAN `step:` line gives the step size.',
      '   Effort in plain language: the LOAD PLAN reads effort as reps in reserve (RPE). When a set is decision-critical and the log_set result carries an `Effort hint`, ask once: «' +
        EFFORT_QUESTION +
        "» — never ask on your own initiative otherwise and never repeat the question for the same exercise. Map the answer or the client's own words into `rpe` (update_last_set on that set, or log_set for the next one): 0 more or «еле дожал» → " +
        EFFORT_RPE_BY_ANSWER.none +
        ', 1–2 more or «ещё пару мог» → ' +
        EFFORT_RPE_BY_ANSWER.oneOrTwo +
        ', 3+ more or «боялся без страховки, силы были» → ' +
        EFFORT_RPE_BY_ANSWER.threeOrMore +
        '. Use the term RPE only if the client does; explain it in one line only when asked or when it is misused (RPE 10 = nothing left, 8 = two reps left). Keep the preference as a client fact (manage_fact, category coaching_preference — "understands RPE" or "prefers plain-word effort questions") so it is not explained again.',
    ].join('\n'),
  ],
  [
    'with the LOAD PLAN suggestion: `recommend:` with the `conservative:` option, adjusted',
    'with the LOAD PLAN suggestion: `recommend:` with the `conservative:` option when the block gives one, adjusted',
  ],
];

function rebind(task: string): string {
  return REPLACEMENTS.reduce((text, [from, to]) => {
    if (!text.includes(from)) {
      throw new Error(`training v12: expected v11 text not found: ${from.slice(0, 60)}`);
    }
    return text.replace(from, to);
  }, task);
}

export const TRAINING_V12 = {
  ...TRAINING_V11,
  version: 'v12',
  render(ctx: TrainingPromptContextV12): Section[] {
    return TRAINING_V11.render(ctx).map(s => (s.id === 'task' ? { ...s, text: rebind(s.text) } : s));
  },
};
