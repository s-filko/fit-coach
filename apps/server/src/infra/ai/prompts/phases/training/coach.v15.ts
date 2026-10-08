import { TRAINING_COACH_V14, V14_LOAD_RULE } from './coach.v14';

/**
 * v15 (coach-quality-proof T4, owner decision 2026-10-08 on load vs reps): the second progression
 * candidate. The live v14 measurement grew 2/3 (was 0/3 with v13) but after a miss the coach held the
 * load and lowered the rep target in 3/3 — a choice the owner called LEGITIMATE coaching, not a fault:
 * sometimes the max weight with fewer reps sets a new mark, then the reps and then the sets (3→4→5)
 * come back. v15 replaces v14's progression sentence with that fuller principle (goal- and
 * range-dependent, the coach says its choice in one phrase); everything else is v14 (and so v13)
 * verbatim. Same switch as v14: env PROMPT_VERSION_TRAINING=v15.
 */
export const V15_LOAD_RULE =
  "The next load follows the history, the plan's range and the client's goal: every set at the top of the range in two workouts in a row — one equipment step up (2.5 kg barbell, 2 per hand dumbbell, 5 stack); a little short of the floor — the same load, aim for the floor again; with a strength goal, a heavier load for fewer reps is a fair way to set a new mark, and then the reps come back and the sets grow 3→4→5; the load drops only when reps fell far below the range and it was not a deliberate heavy try; after a long break — lighter than before it. Say in one phrase which choice this is and why.";

/** The v15 template — v14's text with its progression sentence replaced (BR-LLM-008 derivation). */
export function deriveV15Template(v14Template: string): string {
  if (!v14Template.includes(V14_LOAD_RULE)) {
    throw new Error('coach v15: the v14 needle is missing — the derivation is stale, re-derive from the current v14');
  }
  return v14Template.replace(V14_LOAD_RULE, V15_LOAD_RULE);
}

export const TRAINING_COACH_V15: typeof TRAINING_COACH_V14 = {
  ...TRAINING_COACH_V14,
  version: 'v15',
  render(ctx) {
    return TRAINING_COACH_V14.render(ctx).map(section =>
      section.id === 'coach' ? { ...section, text: deriveV15Template(section.text) } : section,
    );
  },
};
