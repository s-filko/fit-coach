import { CONFIRM_SESSIONS_DEFAULT, DOUBLE_REP_RANGE, STEP_CAP_PCT, TWO_FOR_TWO_SURPLUS } from './params';
import { decideProgression } from './shared';
import type { ProgressionScheme } from './types';

/** Reps first within a range; the load grows one step after the top was reached for the confirming sessions. */
export const doubleProgression: ProgressionScheme = {
  id: 'double_progression',
  version: 1,
  description:
    'Work inside a rep range. When you reach the top of the range for two sessions in a row, the weight goes up one step and the reps start again from the bottom of the range.',
  coachRule: 'Reach the top of the rep range twice in a row, then add one step of weight.',
  citation:
    'ACSM 2009 position stand (Ratamess et al., MSSE 41:687–708): 2–10 % load increments; NSCA 2-for-2 (Baechle & Earle, Essentials of Strength Training and Conditioning)',
  applicableTo: ['strength'],
  defaultParams: goal => ({
    repRange: { ...DOUBLE_REP_RANGE[goal] },
    confirmSessions: CONFIRM_SESSIONS_DEFAULT,
    stepCapPct: STEP_CAP_PCT,
  }),
  decide: (facts, _goal, params) =>
    decideProgression(facts, params, {
      succeeded: v => v === 'at or above top',
      successLabel: 'at the range top',
      surplusReps: TWO_FOR_TWO_SURPLUS,
    }),
};
