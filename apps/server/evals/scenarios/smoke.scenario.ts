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
 * Every HISTORY workout carries a `hist_<yyyymmdd>_<upper|lower|cardio>` key
 * (the owner's real dev-data pattern), NEVER the plan's own session keys
 * (`upper_a`/`lower_a`) — first live run (2026-09-24) showed
 * `persisted.session` checks keyed `upper_a` hitting the seeded
 * completed-but-empty `upper_a` instead of the NEW in-progress session the
 * live steps create, because both shared that key. Only the live-created
 * session carries a plan key now, so `expect.persisted.session.key: 'upper_a'`
 * below can only ever mean that one.
 *
 * `NOW` anchors every relative offset (workout dates AND the history-style
 * keys) to the SAME instant this module is imported; the L3 runner captures
 * its own real T0 moments later (`run-scenario.ts`'s `new Date()`), close
 * enough that the two never disagree about which calendar day a `hist_`
 * key's date-stamp names.
 */

const NOW = new Date();

/** `hist_<yyyymmdd>_<suffix>` for a workout at `offset` — see the file comment. */
function historyKey(offset: string, suffix: 'upper' | 'lower' | 'cardio'): string {
  const date = resolveRelativeTime(offset, NOW);
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
  return `hist_${stamp}_${suffix}`;
}

/** Placed between the last real workout (`-6d`) and T0 — BUG-031's shape. */
const EMPTY_SESSION_OFFSET = '-3d';

export const GREETING_REQUEST = 'привет, хочу потренироваться';
export const GO_LOWER = 'давай низ, погнали';
/**
 * AC-TH-7's negative half (transition-handoff plan Task 5): past-day sets are
 * history, never today's session. Reported while still in session_planning —
 * the coach must acknowledge and stay in planning: no `start_training_session`,
 * no `log_set` (and with neither called, no `session_sets` row can exist).
 * The reply's wording is judged from the transcript by hand (D5), like the
 * BUG-031 step below.
 */
export const PAST_SETS_REPORT = 'вчера на жиме ногами делал 110×12';
/**
 * AC-TH-7's positive half, and the step that starts training now
 * (transition-handoff plan Task 5): a set reported while training NOW opens
 * the session in the SAME run (the U5 hand-off — `npm run smoke` sets
 * TRANSITION_HANDOFF_TARGETS=training,session_planning) and training logs
 * both sets before anything is confirmed to the user.
 */
export const TODAY_SETS_REPORT = 'сделал 2 подхода по 110×12 на жиме ногами';
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
      key: historyKey('-20d', 'upper'),
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
      key: historyKey('-18d', 'lower'),
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
      key: historyKey('-16d', 'upper'),
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
      key: historyKey('-14d', 'lower'),
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
      key: historyKey('-11d', 'upper'),
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
      key: historyKey('-9d', 'cardio'),
      status: 'completed',
      exercises: [{ exercise: 'Treadmill Run', sets: [{ distanceMeters: 4000, durationSeconds: 1500 }] }],
    },
    {
      at: '-6d',
      key: historyKey('-6d', 'lower'),
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
      key: historyKey(EMPTY_SESSION_OFFSET, 'upper'),
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
    '(spec 2026-09-25-smoke-test-design.md): greeting -> planning -> a PAST-day set report (AC-TH-7 negative: ' +
    'stays in planning, nothing logged) -> a NOW set report that starts training in the same run (AC-TH-7 ' +
    'positive, the U5 hand-off) -> sets logged -> finish -> a history question, over a hand-written upper/lower ' +
    'history ending in a completed-but-empty session (BUG-031). Live only: run with `npm run smoke`, never ' +
    'through test:scenarios.',
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
      text: GO_LOWER,
      expect: {
        // No tools/persisted expectations here — the first live run showed the
        // model asking a readiness question instead of starting on this turn
        // (see PAST_SETS_REPORT below, which answers it); staying in
        // session_planning is the only outcome common to both that and a
        // direct start.
        phaseAfter: { phase: 'session_planning' },
      },
    },
    {
      action: 'user',
      text: PAST_SETS_REPORT,
      expect: {
        // AC-TH-7 negative half: yesterday's sets are history — no session
        // opens, nothing is logged. `mustNot` on both tools IS the
        // "no session_sets written" check: log_set needs an active session,
        // and without start_training_session there is none.
        tools: { mustNot: ['start_training_session', 'log_set'] },
        phaseAfter: { phase: 'session_planning' },
      },
    },
    {
      action: 'user',
      text: TODAY_SETS_REPORT,
      expect: {
        // AC-TH-7 positive half + AC-TH-1 live: session_planning's
        // start_training_session hands off in the same run and training logs
        // both reported sets before anything is confirmed to the user.
        tools: { must: ['start_training_session', 'log_set'] },
        phaseAfter: { phase: 'training' },
        persisted: {
          session: {
            key: 'lower_a',
            status: 'in_progress',
            hasStartedAt: true,
            exercises: [
              {
                exercise: 'Leg Press',
                sets: [
                  { reps: 12, weight: 110 },
                  { reps: 12, weight: 110 },
                ],
              },
            ],
          },
        },
      },
    },
    { action: 'advance', at: '+5m' },
    {
      action: 'user',
      text: 'разгибания 55 на 10',
      expect: {
        tools: { must: ['log_set'] },
        phaseAfter: { phase: 'training' },
        persisted: {
          session: {
            key: 'lower_a',
            status: 'in_progress',
            exercises: [
              {
                exercise: 'Leg Press',
                sets: [
                  { reps: 12, weight: 110 },
                  { reps: 12, weight: 110 },
                ],
              },
              { exercise: 'Leg Extension', sets: [{ reps: 10, weight: 55 }] },
            ],
          },
        },
      },
    },
    { action: 'advance', at: '+9m' },
    {
      action: 'user',
      text: 'ещё раз 55 на 10',
      expect: {
        tools: { must: ['log_set'] },
        phaseAfter: { phase: 'training' },
        persisted: {
          session: {
            key: 'lower_a',
            status: 'in_progress',
            exercises: [
              {
                exercise: 'Leg Press',
                sets: [
                  { reps: 12, weight: 110 },
                  { reps: 12, weight: 110 },
                ],
              },
              {
                exercise: 'Leg Extension',
                sets: [
                  { reps: 10, weight: 55 },
                  { reps: 10, weight: 55 },
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
      text: 'сгибания 50 на 10',
      expect: {
        tools: { must: ['log_set'] },
        phaseAfter: { phase: 'training' },
      },
    },
    { action: 'advance', at: '+17m' },
    {
      action: 'user',
      text: 'ещё раз 50 на 10',
      expect: {
        tools: { must: ['log_set'] },
        phaseAfter: { phase: 'training' },
        persisted: {
          session: {
            key: 'lower_a',
            status: 'in_progress',
            exercises: [
              {
                exercise: 'Leg Press',
                sets: [
                  { reps: 12, weight: 110 },
                  { reps: 12, weight: 110 },
                ],
              },
              {
                exercise: 'Leg Extension',
                sets: [
                  { reps: 10, weight: 55 },
                  { reps: 10, weight: 55 },
                ],
              },
              {
                exercise: 'Leg Curl',
                sets: [
                  { reps: 10, weight: 50 },
                  { reps: 10, weight: 50 },
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
        persisted: { session: { key: 'lower_a', status: 'completed', hasCompletedAt: true } },
      },
    },
    { action: 'advance', at: '+2h' },
    {
      action: 'user',
      text: HISTORY_QUESTION,
      // BUG-031's check lives here in intent only: L3 never evaluates `seen`
      // (evals/levels/l3.ts's own header comment — "only a scripted model can
      // observe its own input"; evaluateStep has no `seen` branch at all), so
      // no substring check on the delivered text can distinguish "silently
      // omitted the empty session" from "coincidentally never said the words
      // that would have proven it". The first live run's reply already showed
      // this working (it named the two REAL sessions still inside the depth-5
      // history window and said nothing invented for the empty one) — the
      // orchestrator judges this step from the transcript by hand (D5).
      expect: {
        phaseAfter: { phase: 'chat' },
      },
    },
  ],
};
