import type { Scenario } from '../schema/scenario.schema';

/**
 * Journey g — a greeting after an open session (coach-quality-proof T1 /
 * AC-CQ-1, BUG-053): a workout left `in_progress` three days ago (seeded in
 * the past, exactly the dev shape the bug was found on), the user writes
 * «привет» — the stale session closes through the timeout auto-close path
 * (status completed, `auto_close_reason = 'timeout'`, completed_at = the last
 * activity), the phase leaves training, and chat answers with a greeting. The
 * stale-session-autoclose plan's own scenario reaches the open session
 * in-run; this journey seeds it — the 3-day shape, with the checkpoint
 * already in training.
 */
export const GREETING_REPLY = 'Привет! Давно не виделись.';

export const scenario: Scenario = {
  id: 'g-greeting-after-open-session',
  description:
    'BUG-053: «привет» three days after a workout left in_progress — the session auto-closes (timeout), chat greets, no continuation of the old workout',
  past: {
    user: {
      languageCode: 'ru',
      timezone: 'Europe/Berlin',
      firstName: 'Alex',
      age: 30,
      gender: 'male',
      height: 180,
      weight: 80,
      fitnessLevel: 'intermediate',
      fitnessGoal: 'strength',
      registrationCompleted: true,
    },
    facts: [],
    plan: {
      name: 'Upper/Lower Split',
      sessions: [
        {
          key: 'upper_a',
          title: 'Upper A',
          exercises: [{ exercise: 'Barbell Bench Press', sets: 3, reps: '8-10' }],
        },
      ],
    },
    workouts: [
      {
        at: '-3d',
        key: 'upper_a',
        // The BUG-053 shape: the workout was never finished — it is still open.
        status: 'in_progress',
        exercises: [
          {
            exercise: 'Barbell Bench Press',
            sets: [
              { reps: 8, weight: 80 },
              { reps: 8, weight: 80 },
            ],
          },
        ],
      },
    ],
    conversation: {
      messages: [],
      summaries: [],
      // The checkpoint sits in training with the open session active — where the owner's bot actually was.
      phase: 'training',
    },
  },
  steps: [
    {
      action: 'user',
      text: 'привет',
      script: [{ text: GREETING_REPLY }],
      expect: {
        seen: {
          // The chat prompt names the auto-close as a fact (chat.context v2).
          mustMatch: ['closed automatically after inactivity'],
        },
        tools: { mustNot: ['log_set'] },
        delivered: {
          mustMatch: [GREETING_REPLY, { text: 'ривет', liveOnly: true }],
          // Live: a greeting, not a continuation of the three-day-old workout.
          mustNotMatch: [{ text: 'жим', liveOnly: true }],
        },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'completed',
            hasCompletedAt: true,
            autoCloseReason: 'timeout',
          },
          turnRecorded: true,
        },
        phaseAfter: { phase: 'chat' },
      },
    },
  ],
};
