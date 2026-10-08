import type { Scenario } from '../schema/scenario.schema';
import { BENCH_PRESS_ID, singleExercisePast, trainingSetupSteps } from './weight-logging-shared';

/**
 * Journey i — the weight shorthand (coach-quality-proof T1 / AC-CQ-1):
 * bench 55 kg × 10 is logged, then «ещё 8» with no weight named. BR-TRAINING-047:
 * the weight has no default — the coach passes the same 55 it can see in today's
 * sets (the code never derives it). Scripted: `log_set {reps: 8, weight: 55}` and
 * both sets persist; the Today row the second call sees names the 55. Live: the
 * reply says 55 (liveOnly).
 */
const LOGGED_TEXT = 'Записал!';
const AFTER_FIRST_TEXT = 'Есть первый подход: 55 на 10.';
const SHORTHAND_REPLY_TEXT = 'Записал: ещё 8 с тем же весом, 55 кг.';
const AFTER_SHORTHAND_TEXT = 'Два подхода жима есть, остался один.';

export const scenario: Scenario = {
  id: 'i-weight-shorthand',
  description:
    '«ещё 8» after 55 kg × 10 — the shorthand logs with the same 55 (BR-TRAINING-047: the coach passes the weight, the code never derives it)',
  past: singleExercisePast({
    exerciseId: BENCH_PRESS_ID,
    exerciseName: 'Barbell Bench Press',
    sessionKey: 'upper_a',
    sessionTitle: 'Upper A',
    sets: 3,
    reps: '8-10',
  }),
  steps: [
    ...trainingSetupSteps(
      {
        exerciseId: BENCH_PRESS_ID,
        exerciseName: 'Barbell Bench Press',
        sessionKey: 'upper_a',
        sessionTitle: 'Upper A',
        sets: 3,
        reps: '8-10',
      },
      'Поехали! Начнём с жима лёжа: 3×8-10.',
    ),
    // --- step 3: the first set names the weight ---
    {
      action: 'user',
      text: 'сделал жим 55 на 10',
      script: [
        { text: LOGGED_TEXT, toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 10, weight: 55 } } },
        { text: AFTER_FIRST_TEXT },
      ],
      expect: {
        tools: { must: ['log_set'] },
        delivered: { mustMatch: [LOGGED_TEXT, AFTER_FIRST_TEXT] },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'in_progress',
            exercises: [{ exercise: 'Barbell Bench Press', sets: [{ reps: 10, weight: 55 }] }],
          },
        },
        phaseAfter: { phase: 'training' },
      },
    },
    { action: 'advance', at: '+4m' },
    // --- step 5: «ещё 8» — no weight named, the same 55 must be logged ---
    {
      action: 'user',
      text: 'ещё 8',
      script: [
        {
          text: SHORTHAND_REPLY_TEXT,
          toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 55 } },
        },
        { text: AFTER_SHORTHAND_TEXT },
      ],
      expect: {
        seen: {
          // The model sees today's first set — the 55 it must copy (BR-TRAINING-047).
          mustMatch: ['- Barbell Bench Press [id ' + BENCH_PRESS_ID + '] — plan 3×8-10 — in progress: 10×55'],
        },
        tools: { must: ['log_set'] },
        // Live: the reply says 55 (plan § T1).
        delivered: { mustMatch: [SHORTHAND_REPLY_TEXT, { text: '55', liveOnly: true }] },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'in_progress',
            exercises: [
              { exercise: 'Barbell Bench Press', sets: [{ reps: 10, weight: 55 }, { reps: 8, weight: 55 }] },
            ],
          },
        },
        phaseAfter: { phase: 'training' },
      },
    },
  ],
};
