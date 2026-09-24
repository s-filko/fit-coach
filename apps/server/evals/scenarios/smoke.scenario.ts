import { humanTimeAgo } from '@shared/date-utils';

import { resolveRelativeTime, type Scenario } from '../schema/scenario.schema';

/**
 * The smoke scenario (smoke-test plan, Task 3 / AC-SM-3; spec § 4) — the
 * orchestrator's replacement for the owner's manual Telegram check (D1-D7 in
 * `docs/superpowers/specs/2026-09-25-smoke-test-design.md`). LIVE ONLY: no
 * `script` anywhere — the whole point is a REAL model answering a fixed
 * Russian user script, run through `npm run smoke`. Never run by a worker or
 * by `test:scenarios` (no deterministic twin exists for it, D5/spec § 5).
 *
 * History: an upper/lower split, ~3 weeks of real training (bench, overhead
 * press, lat pulldown, seated row — upper; leg press, leg extension, leg
 * curl — lower), one cardio day (treadmill, a distance set) and one plank
 * (a duration set) worked into the split, all declared through Task 1's
 * `catalog` with real muscle mappings. The LAST entry before T0 is a
 * **completed-but-empty** session (BUG-031: the coach used to invent
 * exercises for a workout that has none) — placed 3 days back so it still
 * sits inside the chat-phase history block's default depth (5) once the
 * live run's own new workout joins the list.
 *
 * The empty session's `at` and the live-run T0 are both anchored to the SAME
 * `new Date()` (`NOW` below) — the L3 runner captures its own real T0
 * (`run-scenario.ts`'s `new Date()`) moments after this module is imported,
 * so the two are near-identical in practice (never literally the same
 * instant, but never far enough apart to cross a calendar day either).
 */

const NOW = new Date();

/** Placed between the last real workout (`-6d`) and T0 — BUG-031's shape. */
const EMPTY_SESSION_OFFSET = '-3d';

/**
 * The exact `when` label `chat-context.v1.ts`'s `buildRecentSessionsSection`
 * would render for the empty session's history line (`humanTimeAgo`, same
 * function, same inputs). BUG-031 is the coach echoing this internal
 * formatting into its OWN reply instead of silently leaving the empty
 * session out — so a literal leak of this label into the delivered text
 * (not a semantic judgement — D5 builds no LLM judge) is exactly what the
 * final step's `delivered.mustNotMatch` below catches.
 */
const EMPTY_SESSION_MARKER = humanTimeAgo(resolveRelativeTime(EMPTY_SESSION_OFFSET, NOW), NOW, 'Europe/Berlin');

export const GREETING_REQUEST = 'привет, хочу потренироваться';
export const GO_UPPER = 'давай верх, погнали';
export const FINISH_REQUEST = 'всё, закончил';
export const HISTORY_QUESTION = 'что я делал на этой неделе?';

export const past: Scenario['past'] = {
  user: {
    languageCode: 'ru',
    timezone: 'Europe/Berlin',
    firstName: 'Alex',
    age: 32,
    gender: 'male',
    height: 180,
    weight: 82,
    fitnessLevel: 'intermediate',
    fitnessGoal: 'strength',
    registrationCompleted: true,
  },
  catalog: [
    {
      name: 'Bench Press',
      exerciseType: 'strength',
      category: 'compound',
      muscles: [
        { group: 'chest', involvement: 'primary' },
        { group: 'shoulders_front', involvement: 'secondary' },
        { group: 'triceps', involvement: 'secondary' },
      ],
    },
    {
      name: 'Overhead Press',
      exerciseType: 'strength',
      category: 'compound',
      muscles: [
        { group: 'shoulders_front', involvement: 'primary' },
        { group: 'triceps', involvement: 'secondary' },
      ],
    },
    {
      name: 'Lat Pulldown',
      exerciseType: 'strength',
      category: 'compound',
      muscles: [
        { group: 'back_lats', involvement: 'primary' },
        { group: 'biceps', involvement: 'secondary' },
      ],
    },
    {
      name: 'Seated Row',
      exerciseType: 'strength',
      category: 'compound',
      muscles: [
        { group: 'back_lats', involvement: 'primary' },
        { group: 'back_traps', involvement: 'secondary' },
        { group: 'biceps', involvement: 'secondary' },
      ],
    },
    {
      name: 'Leg Press',
      exerciseType: 'strength',
      category: 'compound',
      muscles: [
        { group: 'quads', involvement: 'primary' },
        { group: 'glutes', involvement: 'secondary' },
      ],
    },
    {
      name: 'Leg Extension',
      exerciseType: 'strength',
      category: 'isolation',
      muscles: [{ group: 'quads', involvement: 'primary' }],
    },
    {
      name: 'Leg Curl',
      exerciseType: 'strength',
      category: 'isolation',
      muscles: [{ group: 'hamstrings', involvement: 'primary' }],
    },
    {
      name: 'Plank',
      exerciseType: 'isometric',
      category: 'functional',
      muscles: [
        { group: 'core', involvement: 'primary' },
        { group: 'abs', involvement: 'secondary' },
      ],
    },
    {
      name: 'Treadmill Run',
      exerciseType: 'cardio_distance',
      category: 'cardio',
      muscles: [
        { group: 'cardio_system', involvement: 'primary' },
        { group: 'lower_body_endurance', involvement: 'secondary' },
      ],
    },
  ],
  plan: {
    name: 'Upper/Lower Split',
    sessions: [
      {
        key: 'upper_a',
        title: 'Upper A',
        exercises: [
          { exercise: 'Bench Press', sets: 4, reps: '6-8', weight: 80 },
          { exercise: 'Overhead Press', sets: 3, reps: '8-10', weight: 50 },
          { exercise: 'Lat Pulldown', sets: 3, reps: '8-10', weight: 60 },
        ],
      },
      {
        key: 'lower_a',
        title: 'Lower A',
        exercises: [
          { exercise: 'Leg Press', sets: 4, reps: '8-10', weight: 110 },
          { exercise: 'Leg Extension', sets: 3, reps: '10-12', weight: 55 },
          { exercise: 'Leg Curl', sets: 3, reps: '10-12', weight: 50 },
        ],
      },
    ],
  },
  workouts: [
    {
      at: '-20d',
      key: 'upper_a',
      status: 'completed',
      exercises: [
        {
          exercise: 'Bench Press',
          sets: [
            { reps: 8, weight: 75 },
            { reps: 8, weight: 75 },
          ],
        },
        { exercise: 'Overhead Press', sets: [{ reps: 8, weight: 45 }] },
        { exercise: 'Lat Pulldown', sets: [{ reps: 10, weight: 55 }] },
      ],
    },
    {
      at: '-18d',
      key: 'lower_a',
      status: 'completed',
      exercises: [
        {
          exercise: 'Leg Press',
          sets: [
            { reps: 10, weight: 100 },
            { reps: 10, weight: 100 },
          ],
        },
        { exercise: 'Leg Extension', sets: [{ reps: 12, weight: 50 }] },
        { exercise: 'Leg Curl', sets: [{ reps: 12, weight: 45 }] },
      ],
    },
    {
      at: '-16d',
      key: 'upper_a',
      status: 'completed',
      exercises: [
        {
          exercise: 'Bench Press',
          sets: [
            { reps: 8, weight: 77.5 },
            { reps: 8, weight: 77.5 },
          ],
        },
        { exercise: 'Seated Row', sets: [{ reps: 10, weight: 62.5 }] },
        { exercise: 'Overhead Press', sets: [{ reps: 8, weight: 47.5 }] },
      ],
    },
    {
      at: '-14d',
      key: 'lower_a',
      status: 'completed',
      exercises: [
        {
          exercise: 'Leg Press',
          sets: [
            { reps: 10, weight: 105 },
            { reps: 10, weight: 105 },
          ],
        },
        { exercise: 'Leg Curl', sets: [{ reps: 12, weight: 47.5 }] },
        { exercise: 'Plank', sets: [{ durationSeconds: 60 }] },
      ],
    },
    {
      at: '-11d',
      key: 'upper_a',
      status: 'completed',
      exercises: [
        {
          exercise: 'Bench Press',
          sets: [
            { reps: 8, weight: 80 },
            { reps: 8, weight: 80 },
          ],
        },
        { exercise: 'Lat Pulldown', sets: [{ reps: 10, weight: 60 }] },
        { exercise: 'Seated Row', sets: [{ reps: 10, weight: 65 }] },
      ],
    },
    {
      at: '-9d',
      key: 'cardio_a',
      status: 'completed',
      exercises: [{ exercise: 'Treadmill Run', sets: [{ distanceMeters: 4000, durationSeconds: 1500 }] }],
    },
    {
      at: '-6d',
      key: 'lower_a',
      status: 'completed',
      exercises: [
        {
          exercise: 'Leg Press',
          sets: [
            { reps: 8, weight: 110 },
            { reps: 8, weight: 110 },
          ],
        },
        { exercise: 'Leg Extension', sets: [{ reps: 10, weight: 55 }] },
        { exercise: 'Leg Curl', sets: [{ reps: 10, weight: 50 }] },
      ],
    },
    // BUG-031: completed-but-empty — the LAST session before T0.
    {
      at: EMPTY_SESSION_OFFSET,
      key: 'upper_a',
      status: 'completed',
      exercises: [],
    },
  ],
  facts: [],
};

export const scenario: Scenario = {
  id: 'smoke',
  description:
    "The one live workout the orchestrator runs instead of the owner's manual Telegram check " +
    '(spec 2026-09-25-smoke-test-design.md): greeting -> planning -> start -> sets logged -> finish -> ' +
    'a history question, over a hand-written upper/lower history ending in a completed-but-empty ' +
    'session (BUG-031). Live only: run with `npm run smoke`, never through test:scenarios.',
  past,
  steps: [
    {
      action: 'user',
      text: GREETING_REQUEST,
      expect: {
        phaseAfter: { phase: 'session_planning' },
      },
    },
    {
      action: 'user',
      text: GO_UPPER,
      expect: {
        tools: { must: ['start_training_session'] },
        phaseAfter: { phase: 'training' },
        persisted: { session: { key: 'upper_a', status: 'in_progress', hasStartedAt: true } },
      },
    },
    { action: 'advance', at: '+5m' },
    {
      action: 'user',
      text: 'жим 80 на 8',
      expect: {
        tools: { must: ['log_set'] },
        phaseAfter: { phase: 'training' },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'in_progress',
            exercises: [{ exercise: 'Bench Press', sets: [{ reps: 8, weight: 80 }] }],
          },
        },
      },
    },
    { action: 'advance', at: '+9m' },
    {
      action: 'user',
      text: 'ещё подход, 80 на 8',
      expect: {
        tools: { must: ['log_set'] },
        phaseAfter: { phase: 'training' },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'in_progress',
            exercises: [
              {
                exercise: 'Bench Press',
                sets: [
                  { reps: 8, weight: 80 },
                  { reps: 8, weight: 80 },
                ],
              },
            ],
          },
        },
      },
    },
    { action: 'advance', at: '+13m' },
    {
      action: 'user',
      text: 'жим над головой 50 на 8',
      expect: {
        tools: { must: ['log_set'] },
        phaseAfter: { phase: 'training' },
      },
    },
    { action: 'advance', at: '+17m' },
    {
      action: 'user',
      text: 'ещё раз 50 на 8',
      expect: {
        tools: { must: ['log_set'] },
        phaseAfter: { phase: 'training' },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'in_progress',
            exercises: [
              {
                exercise: 'Bench Press',
                sets: [
                  { reps: 8, weight: 80 },
                  { reps: 8, weight: 80 },
                ],
              },
              {
                exercise: 'Overhead Press',
                sets: [
                  { reps: 8, weight: 50 },
                  { reps: 8, weight: 50 },
                ],
              },
            ],
          },
        },
      },
    },
    { action: 'advance', at: '+21m' },
    {
      action: 'user',
      text: FINISH_REQUEST,
      expect: {
        tools: { must: ['finish_training'] },
        phaseAfter: { phase: 'chat' },
        persisted: { session: { key: 'upper_a', status: 'completed', hasCompletedAt: true } },
      },
    },
    { action: 'advance', at: '+2h' },
    {
      action: 'user',
      text: HISTORY_QUESTION,
      expect: {
        phaseAfter: { phase: 'chat' },
        // BUG-031: the coach must not leak the empty session's internal
        // history-block label into its reply (see EMPTY_SESSION_MARKER above).
        delivered: { mustNotMatch: [EMPTY_SESSION_MARKER] },
      },
    },
  ],
};
