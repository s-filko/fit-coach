import { COACH_TEMPLATE_V13, TRAINING_COACH, type TrainingCoachContext } from './coach';

export { COACH_TEMPLATE_V13 };

/**
 * v14 (coach-quality-proof T4 / AC-CQ-4, owner decision 2026-10-08 — «прогрессия веса попробуем через промпт»):
 * the weight-progression candidate. The live measurement (3 samples × GLM) showed the coach holds a load forever:
 * n-load-up 80/80/80 where the spec's rules say one step up (BR-TRAINING-042), n-load-miss 100/100/100 where a miss
 * says one step down (BR-TRAINING-043). The cause, from the exact requests: the history facts were all present, but
 * v13's only load rule anchored every try to a load already used ("the next load they have used; otherwise a rep or
 * two more") — above the top recorded load there is nothing "used" to pick — and nothing in the request defined what
 * a below-floor performance means for the next load. v14 replaces that ONE sentence with the progression principle
 * the durable spec already holds; everything else is v13 verbatim. Selected via env PROMPT_VERSION_TRAINING=v14
 * (v13 stays the default and the baseline) — see index.ts.
 */
export const V13_LOAD_RULE =
  'When last time topped the rep range with reps to spare, the try is the next load they have used; otherwise a rep or two more.';
export const V14_LOAD_RULE =
  'The next load follows the history: every set at the top of the range in two workouts in a row — one equipment step up (2.5 kg barbell, 2 per hand dumbbell, 5 stack); below the range’s floor — one step down; short of the floor only with reps in reserve — the same load; after a long break — lighter than before it.';

/** The v14 template — the v13 text with the one load rule replaced (BR-LLM-008 derivation). */
export function deriveV14Template(v13Template: string): string {
  if (!v13Template.includes(V13_LOAD_RULE)) {
    throw new Error('coach v14: the v13 needle is missing — the derivation is stale, re-derive from the current v13');
  }
  return v13Template.replace(V13_LOAD_RULE, V14_LOAD_RULE);
}

export const TRAINING_COACH_V14: typeof TRAINING_COACH = {
  ...TRAINING_COACH,
  version: 'v14',
  render(ctx: TrainingCoachContext) {
    const v13 = TRAINING_COACH.render(ctx);
    return v13.map(section =>
      section.id === 'coach' ? { ...section, text: deriveV14Template(section.text) } : section,
    );
  },
};
