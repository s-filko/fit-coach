import type { Scenario } from '../schema/scenario.schema';
import { BENCH_PRESS_ID, singleExercisePast, trainingSetupSteps } from './weight-logging-shared';

/**
 * Journey l — the correction (coach-quality-proof T1 / AC-CQ-1): «нет, было 60»
 * after 55 × 8 → `update_last_set` with weight 60; the set persists as 8×60 and
 * the correction the model reads back names both sides (Before/After through the
 * shared formatter, T6).
 */
const LOGGED_TEXT = 'Записал: жим 55 на 8.';
const AFTER_LOG_TEXT = 'Один подход жима записан.';
const CORRECTION_REPLY_TEXT = 'Поправил: было 55, теперь 60 кг на 8.';
const AFTER_CORRECTION_TEXT = 'Так и запишем: 60 на 8.';

export const scenario: Scenario = {
  id: 'l-correction',
  description: '«нет, было 60» after 55 × 8 — update_last_set corrects the weight to 60',
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
    // --- step 3: the set that will be corrected ---
    {
      action: 'user',
      text: 'сделал жим 55 на 8',
      script: [
        { text: LOGGED_TEXT, toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 55 } } },
        { text: AFTER_LOG_TEXT },
      ],
      expect: {
        tools: { must: ['log_set'] },
        delivered: { mustMatch: [LOGGED_TEXT] },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'in_progress',
            exercises: [{ exercise: 'Barbell Bench Press', sets: [{ reps: 8, weight: 55 }] }],
          },
        },
        phaseAfter: { phase: 'training' },
      },
    },
    { action: 'advance', at: '+4m' },
    // --- step 5: «нет, было 60» — update_last_set ---
    {
      action: 'user',
      text: 'нет, было 60',
      script: [
        {
          text: CORRECTION_REPLY_TEXT,
          toolCall: { name: 'update_last_set', args: { exercise_id: BENCH_PRESS_ID, weight: 60 } },
        },
        { text: AFTER_CORRECTION_TEXT },
      ],
      expect: {
        // The correction confirmation the next call would read names both sides (T6 shared formatter).
        seen: { mustMatch: ['Before: 8 reps @ 55 kg', 'After: 8 reps @ 60 kg'] },
        tools: { must: ['update_last_set'] },
        delivered: { mustMatch: [CORRECTION_REPLY_TEXT] },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'in_progress',
            exercises: [{ exercise: 'Barbell Bench Press', sets: [{ reps: 8, weight: 60 }] }],
          },
        },
        phaseAfter: { phase: 'training' },
      },
    },
  ],
};
