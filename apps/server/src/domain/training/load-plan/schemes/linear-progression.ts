import { CONFIRM_SESSIONS_DEFAULT, LINEAR_FIXED_REPS, STEP_CAP_PCT } from './params';
import { decideProgression } from './shared';
import type { ProgressionScheme } from './types';

/** Fixed reps every set; the load grows one step once the reps were made for the confirming sessions. */
export const linearProgression: ProgressionScheme = {
  id: 'linear_progression',
  version: 1,
  description:
    'Fixed sets and reps every workout. When you make all the reps for two sessions in a row, the weight goes up one step; the rep target does not change.',
  coachRule: 'Make all the fixed reps twice in a row, then add one step of weight.',
  citation:
    'ACSM 2009 position stand (Ratamess et al., MSSE 41:687–708): 2–10 % load increments; Rippetoe & Kilgore, Starting Strength (fixed-rep linear progression convention)',
  applicableTo: ['strength'],
  defaultParams: goal => ({
    repRange: { min: LINEAR_FIXED_REPS[goal], max: LINEAR_FIXED_REPS[goal] },
    fixedReps: LINEAR_FIXED_REPS[goal],
    confirmSessions: CONFIRM_SESSIONS_DEFAULT,
    stepCapPct: STEP_CAP_PCT,
  }),
  decide: (facts, _goal, params) =>
    decideProgression(facts, params, {
      succeeded: v => v !== 'below floor',
      successLabel: 'fixed reps made',
    }),
};
