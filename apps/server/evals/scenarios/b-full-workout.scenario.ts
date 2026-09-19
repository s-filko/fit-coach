import type { Scenario } from '../schema/scenario.schema';

/**
 * Journey B — a full workout, greeting to finish (training-journey-scenarios
 * plan, Task 4 / AC-TJ-2, AC-TJ-3).
 *
 * A registered user with two completed workouts (−4d `upper_a` with bench
 * weights, −2d `lower_a` with squat weights) and an active Upper/Lower split
 * walks the whole journey: greeting → session_planning → proposal →
 * `start_training_session` → bench sets → pull-up sets (bench auto-completes
 * on the switch) → `finish_training` → "спасибо" back in chat. The scripted
 * model carries the text and the tool call in ONE AI message on the first
 * bench set ("Записал!" + `log_set`) — the AC-CC-3 shape.
 *
 * The weekday/age labels ("2d ago (Fri) afternoon", "4d ago (Wed)") and the
 * 20-minute duration assume the deterministic layer's pinned T0 —
 * 2026-09-20T10:00:00.000Z, a Sunday in Europe/Berlin; the integration test must
 * keep that T0. `start_training_session` and `log_set` take exercise IDs; the
 * catalog UUIDs below are the fixed test-setup ones (src/app/test/setup.ts),
 * exactly the `[ID:…]` values the plan blocks render and a real model would
 * copy from them.
 */

/** Fixed test-catalog exercise IDs (src/app/test/setup.ts). */
export const BENCH_PRESS_ID = 'c7b0899c-a0f9-47ca-a69d-4bcd531b0c95';
export const PULL_UPS_ID = '8c88ebce-f5df-4d33-afdb-0b096a0dd7a8';

/** The step texts — the AC-CC-1 assertions quote the previous one verbatim. */
export const GREETING_REQUEST = 'привет, хочу потренироваться';
export const GO_UPPER = 'давай верх';
export const LETS_GO = 'да, поехали';
export const FINISH_REQUEST = 'всё, закончил';

/** The scripted AI replies — the AC-CC-1 assertions quote the delivered one. */
export const GREETING_AND_TRANSITION_TEXT = 'Привет, Алекс! Отлично, давай подберём тренировку.';
export const PLANNING_FINAL_TEXT = 'Перешли к планированию. Какую группу сегодня нагружаем?';
export const START_FINAL_TEXT = 'Поехали! Начни с жима лёжа: 3 подхода 8-10 повторов с 80 кг.';
export const LOGGED_TEXT = 'Записал!';
export const AFTER_BENCH_1_TEXT = 'Отлично, есть первый подход!';
export const AFTER_BENCH_2_TEXT = 'Два подхода жима есть. Дальше — подтягивания?';
export const AFTER_PULLUP_1_TEXT = 'Подтягивания пошли, жим лёжа закрыт автоматом.';
export const AFTER_PULLUP_2_TEXT = 'Два подхода подтягиваний есть.';
export const FINISH_FINAL_TEXT = 'Отличная работа! Четыре подхода за 20 минут. Отдыхай!';
export const THANKS_REPLY_TEXT = 'Всегда пожалуйста! До следующей тренировки.';

export const scenario: Scenario = {
  id: 'b-full-workout',
  description:
    'a full workout, greeting to finish: planning → start → sets → finish over the real test DB; ' +
    'AC-CC-1 (turns lost after transitions) and AC-CC-3 ("Записал!" not delivered) reproductions',
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
    plan: {
      name: 'Upper/Lower Split',
      sessions: [
        {
          key: 'upper_a',
          title: 'Upper A',
          exercises: [
            { exercise: 'Barbell Bench Press', sets: 3, reps: '8-10', weight: 80 },
            { exercise: 'Pull-ups', sets: 3, reps: '6-8' },
          ],
        },
        {
          key: 'lower_a',
          title: 'Lower A',
          exercises: [{ exercise: 'Barbell Back Squat', sets: 3, reps: '8-10', weight: 100 }],
        },
      ],
    },
    workouts: [
      {
        at: '-4d',
        key: 'upper_a',
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
      {
        at: '-2d',
        key: 'lower_a',
        exercises: [
          {
            exercise: 'Barbell Back Squat',
            sets: [
              { reps: 10, weight: 100 },
              { reps: 10, weight: 100 },
            ],
          },
        ],
      },
    ],
    facts: [{ category: 'coaching_preference', fact: 'Prefers short, direct replies without long intros' }],
  },
  steps: [
    // --- step 0: greeting, chat → session_planning ---
    {
      action: 'user',
      text: GREETING_REQUEST,
      script: [
        {
          text: GREETING_AND_TRANSITION_TEXT,
          toolCall: { name: 'request_transition', args: { toPhase: 'session_planning', reason: 'user wants to train' } },
        },
        { text: PLANNING_FINAL_TEXT },
      ],
      expect: {
        tools: { must: ['request_transition'] },
        delivered: { mustMatch: [PLANNING_FINAL_TEXT] },
        persisted: { turnRecorded: true },
        phaseAfter: { phase: 'session_planning' },
      },
    },
    // --- step 1: "давай верх" — the proposal, built on history + recovery + plan ---
    {
      action: 'user',
      text: GO_UPPER,
      script: [
        { text: 'Отлично — Upper A: жим лёжа 3×8-10 @ 80 кг, подтягивания 3×6-8. Начинаем?' },
      ],
      expect: {
        seen: {
          mustMatch: [
            '=== RECENT TRAINING HISTORY (last sessions) ===',
            '1. lower_a (2d ago (Fri) afternoon) — completed — 60 min',
            '- Barbell Back Squat: 10x100kg, 10x100kg',
            '2. upper_a (4d ago (Wed)) — completed — 60 min',
            '- Barbell Bench Press: 8x80kg, 8x80kg',
            '=== RECOVERY TIMELINE (muscle groups) ===',
            '- quads: ⚠ 2d ago (Fri) afternoon — may still be sore',
            '- chest: 4d ago (Wed) — likely recovered',
            '=== ACTIVE WORKOUT PLAN ===',
            'Plan: Upper/Lower Split',
            '### Upper A (key: upper_a)',
            `[ID:${BENCH_PRESS_ID}] Barbell Bench Press: 3x8-10 @ 80kg (rest: 120s)`,
            // BUG-018 point 1: the chat→session_planning transition ended the
            // episode, so the immediately preceding turn is gone from the input.
            { text: GREETING_REQUEST, knownBug: 'BUG-018/AC-CC-1' },
            { text: PLANNING_FINAL_TEXT, knownBug: 'BUG-018/AC-CC-1' },
          ],
        },
        delivered: { mustMatch: ['жим лёжа 3×8-10 @ 80 кг'] },
        persisted: { turnRecorded: true },
        phaseAfter: { phase: 'session_planning' },
      },
    },
    // --- step 2: "да, поехали" — start_training_session with the plan IDs ---
    {
      action: 'user',
      text: LETS_GO,
      script: [
        {
          toolCall: {
            name: 'start_training_session',
            args: {
              sessionKey: 'upper_a',
              sessionName: 'Upper A',
              reasoning: 'Upper day per the active split; chest recovered, quads still sore — upper is the right call.',
              exercises: [
                {
                  exerciseId: BENCH_PRESS_ID,
                  exerciseName: 'Barbell Bench Press',
                  targetSets: 3,
                  targetReps: '8-10',
                  targetWeight: 80,
                  restSeconds: 120,
                },
                { exerciseId: PULL_UPS_ID, exerciseName: 'Pull-ups', targetSets: 3, targetReps: '6-8', restSeconds: 120 },
              ],
              estimatedDuration: 60,
            },
          },
        },
        { text: START_FINAL_TEXT },
      ],
      expect: {
        tools: { must: ['start_training_session'] },
        delivered: { mustMatch: ['Поехали!'] },
        phaseAfter: { phase: 'training' },
        persisted: { session: { key: 'upper_a', status: 'in_progress', hasStartedAt: true } },
      },
    },
    { action: 'advance', at: '+5m' },
    // --- step 4: bench set 1 — "Записал!" rides the same AI message as log_set ---
    {
      action: 'user',
      text: 'сделал жим 80 на 8',
      script: [
        {
          text: LOGGED_TEXT,
          toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 80 } },
        },
        { text: AFTER_BENCH_1_TEXT },
      ],
      expect: {
        seen: {
          mustMatch: [
            '=== WORKOUT OVERVIEW ===',
            'SESSION GUIDE',
            'Upper A · ~60 min',
            `[ID:${BENCH_PRESS_ID}] Barbell Bench Press: 3×8-10 @ 80 kg`,
            `[ID:${PULL_UPS_ID}] Pull-ups: 3×6-8`,
            'ACTIVE: none — log any set to start an exercise',
            '=== PREVIOUS SESSION (same template — 4d ago (Wed)) ===',
            `Barbell Bench Press [ID:${BENCH_PRESS_ID}]`,
            '  Set 1: 8 reps @ 80 kg',
            '  Set 2: 8 reps @ 80 kg',
            // BUG-018 point 1: the session_planning→training transition ate
            // the "да, поехали" turn the same way.
            { text: LETS_GO, knownBug: 'BUG-018/AC-CC-1' },
            { text: START_FINAL_TEXT, knownBug: 'BUG-018/AC-CC-1' },
          ],
        },
        tools: { must: ['log_set'] },
        // BUG-018 point 3: the adapter delivers only the last AI text, so the
        // "Записал!" written alongside the tool call is lost.
        delivered: { mustMatch: [{ text: LOGGED_TEXT, knownBug: 'BUG-018/AC-CC-3' }, AFTER_BENCH_1_TEXT] },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'in_progress',
            exercises: [{ exercise: 'Barbell Bench Press', sets: [{ reps: 8, weight: 80 }] }],
          },
        },
        phaseAfter: { phase: 'training' },
      },
    },
    { action: 'advance', at: '+9m' },
    // --- step 6: bench set 2 ---
    {
      action: 'user',
      text: 'ещё раз 80 на 8',
      script: [
        {
          text: LOGGED_TEXT,
          toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 80 } },
        },
        { text: AFTER_BENCH_2_TEXT },
      ],
      expect: {
        seen: {
          mustMatch: [
            `[IN PROGRESS] [ID:${BENCH_PRESS_ID}] Barbell Bench Press: 3×8-10 @ 80 kg (1/3 sets)`,
            `ACTIVE: Barbell Bench Press [ID:${BENCH_PRESS_ID}] — 1 set(s) done, 2 remaining per plan.`,
          ],
        },
        tools: { must: ['log_set'] },
        delivered: { mustMatch: [{ text: LOGGED_TEXT, knownBug: 'BUG-018/AC-CC-3' }, AFTER_BENCH_2_TEXT] },
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
            ],
          },
        },
        phaseAfter: { phase: 'training' },
      },
    },
    { action: 'advance', at: '+13m' },
    // --- step 8: pull-up set 1 — the switch auto-completes bench ---
    {
      action: 'user',
      text: 'подтянулся 8 раз',
      script: [
        { toolCall: { name: 'log_set', args: { exerciseId: PULL_UPS_ID, reps: 8 } } },
        { text: AFTER_PULLUP_1_TEXT },
      ],
      expect: {
        tools: { must: ['log_set'] },
        delivered: { mustMatch: [AFTER_PULLUP_1_TEXT] },
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
              { exercise: 'Pull-ups', sets: [{ reps: 8 }] },
            ],
          },
        },
        phaseAfter: { phase: 'training' },
      },
    },
    { action: 'advance', at: '+17m' },
    // --- step 10: pull-up set 2 — bench shows DONE in the overview ---
    {
      action: 'user',
      text: 'ещё 8 подтягиваний',
      script: [
        { toolCall: { name: 'log_set', args: { exerciseId: PULL_UPS_ID, reps: 8 } } },
        { text: AFTER_PULLUP_2_TEXT },
      ],
      expect: {
        seen: {
          mustMatch: [
            `[DONE       ] [ID:${BENCH_PRESS_ID}] Barbell Bench Press: 3×8-10 @ 80 kg (2/3 sets)`,
            `[IN PROGRESS] [ID:${PULL_UPS_ID}] Pull-ups: 3×6-8 (1/3 sets)`,
          ],
        },
        tools: { must: ['log_set'] },
        delivered: { mustMatch: [AFTER_PULLUP_2_TEXT] },
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
              {
                exercise: 'Pull-ups',
                sets: [
                  { reps: 8 },
                  { reps: 8 },
                ],
              },
            ],
          },
        },
        phaseAfter: { phase: 'training' },
      },
    },
    // +21m, not +20m: `advanceTimers: true` lets the fake clock drift forward
    // by real elapsed milliseconds, so the finish lands at 20m + drift and
    // durationMinutes' floor is exactly 20 either way.
    { action: 'advance', at: '+21m' },
    // --- step 12: "всё, закончил" — finish_training, training → chat ---
    {
      action: 'user',
      text: FINISH_REQUEST,
      script: [
        { toolCall: { name: 'finish_training', args: { feedback: 'Хорошая тренировка' } } },
        { text: FINISH_FINAL_TEXT },
      ],
      expect: {
        tools: { must: ['finish_training'] },
        delivered: { mustMatch: ['Отличная работа!'] },
        phaseAfter: { phase: 'chat' },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'completed',
            hasCompletedAt: true,
            // startedAt is set at the step-2 transition commit (T0); the clock
            // reaches T0+20m here — see the advances above.
            durationMinutes: 20,
            exercises: [
              {
                exercise: 'Barbell Bench Press',
                sets: [
                  { reps: 8, weight: 80 },
                  { reps: 8, weight: 80 },
                ],
              },
              {
                exercise: 'Pull-ups',
                sets: [
                  { reps: 8 },
                  { reps: 8 },
                ],
              },
            ],
          },
          turnRecorded: true,
        },
      },
    },
    // --- step 13: "спасибо" back in chat — the new workout leads the history ---
    {
      action: 'user',
      text: 'спасибо',
      script: [{ text: THANKS_REPLY_TEXT }],
      expect: {
        seen: {
          mustMatch: [
            'RECENT TRAINING HISTORY (last 5 sessions):',
            '- upper_a — today (Sun) afternoon, 20 min: Barbell Bench Press (2 sets), Pull-ups (2 sets)',
            // BUG-018 point 1: the training→chat transition dropped the
            // "всё, закончил" turn.
            { text: FINISH_REQUEST, knownBug: 'BUG-018/AC-CC-1' },
            { text: FINISH_FINAL_TEXT, knownBug: 'BUG-018/AC-CC-1' },
          ],
        },
        delivered: { mustMatch: [THANKS_REPLY_TEXT] },
        phaseAfter: { phase: 'chat' },
      },
    },
  ],
};
