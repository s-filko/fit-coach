import type { Scenario } from '../schema/scenario.schema';
import { SQUAT_ID, singleExercisePast, trainingSetupSteps } from './weight-logging-shared';

/**
 * Journey k — the weight is unknown (coach-quality-proof T1 / AC-CQ-1,
 * BR-TRAINING-047): an exercise with no history, «сделал 10» with no weight
 * named. The scripted model tries the reps-only call — the schema rejects it
 * (`<exercise>: weight is required`), nothing is stored,
 * and the coach asks for the weight. `seen` pins the rejection text reaching
 * the model (deterministic-only plane); live, a well-behaved model asks
 * directly — with or without attempting the call — so the tools plane asserts
 * nothing and the persisted plane asserts no set was invented.
 */
const ASK_WEIGHT_TEXT = 'С каким весом ты делаешь присед? Скажи — сразу запишу.';

export const scenario: Scenario = {
  id: 'k-weight-unknown',
  description:
    'no history, «сделал 10» with no weight — the reps-only call is rejected by the schema (BR-TRAINING-047), nothing stored, the coach asks',
  past: singleExercisePast({
    exerciseId: SQUAT_ID,
    exerciseName: 'Barbell Back Squat',
    sessionKey: 'lower_a',
    sessionTitle: 'Lower A',
    sets: 3,
    reps: '8-10',
  }),
  steps: [
    ...trainingSetupSteps(
      {
        exerciseId: SQUAT_ID,
        exerciseName: 'Barbell Back Squat',
        sessionKey: 'lower_a',
        sessionTitle: 'Lower A',
        sets: 3,
        reps: '8-10',
      },
      'Поехали! Начнём с приседа: 3×8-10.',
    ),
    // --- step 3: «сделал 10» — no weight anywhere to take it from ---
    {
      action: 'user',
      text: 'сделал 10',
      script: [
        { toolCall: { name: 'log_set', args: { exerciseId: SQUAT_ID, reps: 10 } } },
        { text: ASK_WEIGHT_TEXT },
      ],
      expect: {
        seen: {
          mustMatch: [
            // The honest no-history row the model had in front of it.
            '- no earlier record',
            // The schema rejection the failed call fed back (BR-TRAINING-047).
            'weight is required',
          ],
        },
        delivered: { mustMatch: [ASK_WEIGHT_TEXT, { text: 'вес', liveOnly: true }] },
        persisted: {
          session: {
            key: 'lower_a',
            status: 'in_progress',
            // Nothing was stored — no session_exercises row exists until a set
            // is logged, and no set with an invented weight was logged.
            exercises: [],
          },
        },
        phaseAfter: { phase: 'training' },
      },
    },
  ],
};
