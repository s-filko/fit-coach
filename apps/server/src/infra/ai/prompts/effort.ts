/**
 * The plain-language effort question and its answer → RPE mapping (plan-fixes item 10): ONE source for the
 * `log_set` effort hint, the `log_set` tool description and the training prompt (v12). The domain decides WHEN to ask
 * (`effort hint`); the words live here. A prompt test checks the quoted text against these constants.
 */

/** Asked once per exercise per session when a decision-critical set was stored without RPE (client-facing Russian). */
export const EFFORT_QUESTION = 'Сколько ещё раз смог бы сделать на этом весе? 0, 1–2 или 3 и больше?';

/** The RPE a plain answer maps to (RPE = 10 − reps left in reserve; "3+" is the lowest RPE the rules distinguish). */
export const EFFORT_RPE_BY_ANSWER = { none: 10, oneOrTwo: 8, threeOrMore: 7 } as const;

/** `0 → 10, 1–2 → 8, 3+ → 7` */
export const EFFORT_MAPPING_TEXT = `0 → ${EFFORT_RPE_BY_ANSWER.none}, 1–2 → ${EFFORT_RPE_BY_ANSWER.oneOrTwo}, 3+ → ${EFFORT_RPE_BY_ANSWER.threeOrMore}`;
