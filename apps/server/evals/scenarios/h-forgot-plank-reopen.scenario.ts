import type { Scenario } from '../schema/scenario.schema';

import { GREETING_REPLY, scenario as journeyG } from './g-greeting-after-open-session.scenario';

/**
 * Journey h — «я вчера не дописал планку» (coach-quality-proof T1 / AC-CQ-1):
 * continues journey g — after the stale session auto-closed, the user
 * remembers two unlogged plank holds. The coach reopens the closed workout
 * (`reopen_workout`, the chat → training hand-off) and logs the two isometric
 * sets in the OLD session, dated to its last activity (BR-TRAINING-030 retro
 * dating). The plank is seeded in the old session's exercises (one name, an
 * exact catalog match for `log_set` by name) with no sets yet.
 */
export const REOPEN_REPLY = 'Дописал планку: 2 по 45 секунд к той тренировке.';

/** The past is journey g's world (the open upper_a with bench sets and an empty plank) plus the plank row. */
const gPast = journeyG.past;

export const scenario: Scenario = {
  id: 'h-forgot-plank-reopen',
  description:
    'after g: «я вчера не дописал планку, 2 по 45 секунд» — reopen_workout returns the closed session to training and two isometric sets land in it, dated to its last activity',
  past: {
    ...gPast,
    catalog: [
      {
        name: 'Plank',
        exerciseType: 'isometric',
        category: 'functional',
        muscles: [{ group: 'core', involvement: 'primary' }],
      },
    ],
    workouts: (gPast.workouts ?? []).map(w => ({
      ...w,
      exercises: [
        ...w.exercises,
        // The plank was planned in the old session but never logged — that is what was forgotten.
        { exercise: 'Plank', sets: [] },
      ],
    })),
  },
  steps: [
    // --- step 0: journey g's greeting — the stale session closes ---
    {
      action: 'user',
      text: 'привет',
      script: [{ text: GREETING_REPLY }],
      expect: {
        persisted: { session: { key: 'upper_a', status: 'completed', autoCloseReason: 'timeout' } },
        phaseAfter: { phase: 'chat' },
      },
    },
    // --- step 1: the forgotten plank — reopen, then two isometric sets in the old session ---
    {
      action: 'user',
      text: 'я вчера не дописал планку, 2 по 45 секунд',
      script: [
        { toolCall: { name: 'reopen_workout', args: {} } },
        { toolCall: { name: 'log_set', args: { exerciseName: 'Plank', durationSeconds: 45 } } },
        { toolCall: { name: 'log_set', args: { exerciseName: 'Plank', durationSeconds: 45 } } },
        { text: REOPEN_REPLY },
      ],
      expect: {
        tools: { must: ['reopen_workout', 'log_set'] },
        delivered: { mustMatch: [REOPEN_REPLY] },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'in_progress',
            exercises: [
              {
                exercise: 'Barbell Bench Press',
                sets: [
                  { reps: 8, weight: 80 },
                  { reps: 8, weight: 80 },
                ],
              },
              { exercise: 'Plank', sets: [{ durationSeconds: 45 }, { durationSeconds: 45 }] },
            ],
          },
          turnRecorded: true,
        },
        phaseAfter: { phase: 'training' },
      },
    },
  ],
};
