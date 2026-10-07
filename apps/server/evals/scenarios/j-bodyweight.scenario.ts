import type { Scenario } from '../schema/scenario.schema';
import { PULL_UPS_ID, singleExercisePast, trainingSetupSteps } from './weight-logging-shared';

/**
 * Journey j — bodyweight vs weighted pull-ups (coach-quality-proof T1 / AC-CQ-1,
 * BR-TRAINING-047): «подтягивания 8 раз без веса» logs `weight: 0` →
 * `functional_reps`, and the confirmation names it "bodyweight" in full;
 * «подтягивания с поясом 10 кг, 6» logs a strength set at 10 kg. The scripted
 * layer pins both persistences and the bodyweight wording the model reads back.
 */
const BODYWEIGHT_REPLY_TEXT = 'Записал: 8 подтягиваний с собственным весом.';
const AFTER_BODYWEIGHT_TEXT = 'Один подход есть, без веса так и запишем.';
const BELT_REPLY_TEXT = 'Записал: 6 повторов с поясом, 10 кг.';
const AFTER_BELT_TEXT = 'Два подхода подтягиваний есть.';

export const scenario: Scenario = {
  id: 'j-bodyweight',
  description:
    'pull-ups named bodyweight (weight 0 → functional_reps, the confirmation says bodyweight) vs a belt set at 10 kg (BR-TRAINING-047)',
  past: singleExercisePast({
    exerciseId: PULL_UPS_ID,
    exerciseName: 'Pull-ups',
    sessionKey: 'upper_a',
    sessionTitle: 'Upper A',
    sets: 3,
    reps: '6-8',
  }),
  steps: [
    ...trainingSetupSteps(
      {
        exerciseId: PULL_UPS_ID,
        exerciseName: 'Pull-ups',
        sessionKey: 'upper_a',
        sessionTitle: 'Upper A',
        sets: 3,
        reps: '6-8',
      },
      'Поехали! Начнём с подтягиваний: 3×6-8.',
    ),
    // --- step 3: «без веса» — the coach's explicit 0, named bodyweight ---
    {
      action: 'user',
      text: 'подтягивания 8 раз без веса',
      script: [
        {
          text: BODYWEIGHT_REPLY_TEXT,
          toolCall: { name: 'log_set', args: { exerciseId: PULL_UPS_ID, reps: 8, weight: 0 } },
        },
        { text: AFTER_BODYWEIGHT_TEXT },
      ],
      expect: {
        // The confirmation the next model call reads names the set "bodyweight" in full (T6 wording).
        seen: { mustMatch: ['8 reps @ bodyweight'] },
        tools: { must: ['log_set'] },
        delivered: { mustMatch: [BODYWEIGHT_REPLY_TEXT] },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'in_progress',
            exercises: [{ exercise: 'Pull-ups', sets: [{ reps: 8 }] }],
          },
        },
        phaseAfter: { phase: 'training' },
      },
    },
    { action: 'advance', at: '+4m' },
    // --- step 5: «с поясом 10 кг» — a strength set at 10 kg ---
    {
      action: 'user',
      text: 'подтягивания с поясом 10 кг, 6',
      script: [
        {
          text: BELT_REPLY_TEXT,
          toolCall: { name: 'log_set', args: { exerciseId: PULL_UPS_ID, reps: 6, weight: 10 } },
        },
        { text: AFTER_BELT_TEXT },
      ],
      expect: {
        // Today's row names the first set bodyweight (the short form, T6).
        seen: { mustMatch: ['- Pull-ups [id ' + PULL_UPS_ID + '] — plan 3×6-8 — in progress: 8×bodyweight'] },
        tools: { must: ['log_set'] },
        delivered: { mustMatch: [BELT_REPLY_TEXT] },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'in_progress',
            exercises: [{ exercise: 'Pull-ups', sets: [{ reps: 8 }, { reps: 6, weight: 10 }] }],
          },
        },
        phaseAfter: { phase: 'training' },
      },
    },
  ],
};
