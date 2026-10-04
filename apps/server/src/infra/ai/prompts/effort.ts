/**
 * The answer → RPE mapping text used by the `log_set` tool description for the `rpe` field
 * (RPE = 10 − reps left in reserve; "3+" is the lowest RPE the rules distinguish).
 */
const EFFORT_RPE_BY_ANSWER = { none: 10, oneOrTwo: 8, threeOrMore: 7 } as const;

/** `0 → 10, 1–2 → 8, 3+ → 7` */
export const EFFORT_MAPPING_TEXT = `0 → ${EFFORT_RPE_BY_ANSWER.none}, 1–2 → ${EFFORT_RPE_BY_ANSWER.oneOrTwo}, 3+ → ${EFFORT_RPE_BY_ANSWER.threeOrMore}`;
