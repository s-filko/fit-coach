import type { Scenario } from '../schema/scenario.schema';

/**
 * Journey A — greeting after a pause, with past workouts
 * (training-journey-scenarios plan, Task 3 / AC-TJ-2, AC-TJ-3; the BUG-018
 * reproduction over the real test DB).
 *
 * Mirrors the owner's 2026-09-19 evidence: a registered user with two
 * completed workouts (−4d `upper_a`, −2d `lower_a`), an active plan, one
 * durable fact, one stored episode summary whose `openItems` say the plan is
 * ready and pending save, and a one-turn chat exchange 14 h back. The user
 * writes "привет"; the scripted model greets AND calls
 * `request_transition(session_planning)` in one AI message, then writes a
 * final text after the tool result.
 *
 * The weekday labels below ("2d ago (Fri) afternoon", "4d ago (Wed)") assume
 * the deterministic layer's pinned T0 — 2026-09-20T10:00:00.000Z, a Sunday
 * in Europe/Berlin; the integration test must keep that T0.
 */

/** The greeting the scripted model writes alongside the transition call (AC-CC-3). */
export const GREETING_TEXT = 'Привет, Алекс! Рад тебя видеть.';

/** The final text after the transition tool result. */
export const FINAL_TEXT = 'Отлично! В прошлый раз мы собрались сохранить план тренировок — начнём с него?';

/** The one-turn exchange seeded into the checkpoint (AC-CC-1: must stay verbatim). */
export const PAST_HUMAN_TEXT = 'Привет! Как прошла тренировка в среду?';
export const PAST_AI_TEXT = 'Среда прошла отлично: жим лёжа 80 кг на 8 повторов в двух подходах.';

/**
 * The gap note AC-CC-2 places before the current message (fixed, Task 2):
 * "The user returns after …" with the measured gap (14 h).
 */
export const GAP_NOTE_MARKER = 'The user returns after 14 h';

export const scenario: Scenario = {
  id: 'a-greeting-after-pause',
  description:
    'BUG-018: "привет" after a 14 h pause — past workouts, a pending-save episode, one earlier exchange; the model greets and transitions to session_planning',
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
          exercises: [{ exercise: 'Barbell Bench Press', sets: 3, reps: '8-10', weight: 80 }],
        },
        {
          key: 'lower_a',
          title: 'Lower A',
          exercises: [{ exercise: 'Barbell Squat', sets: 3, reps: '8-10', weight: 100 }],
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
            exercise: 'Barbell Squat',
            sets: [
              { reps: 10, weight: 100 },
              { reps: 10, weight: 100 },
            ],
          },
        ],
      },
    ],
    facts: [{ category: 'coaching_preference', fact: 'Prefers short, direct replies without long intros' }],
    conversation: {
      messages: [
        { role: 'human', text: PAST_HUMAN_TEXT },
        { role: 'ai', text: PAST_AI_TEXT },
      ],
      summaries: [
        {
          at: '-3d',
          phaseAtEnd: 'chat',
          topics: ['Discussed the upper/lower split'],
          decisions: ['Upper A and Lower A approved'],
          userState: ['Motivated, training consistently'],
          trainingFeedback: [],
          openItems: ['The workout plan is ready and pending save'],
        },
      ],
      lastUserMessageAt: '-14h',
    },
  },
  steps: [
    {
      action: 'user',
      text: 'привет',
      script: [
        {
          text: GREETING_TEXT,
          toolCall: { name: 'request_transition', args: { toPhase: 'session_planning', reason: 'greeting after a pause — ready to plan the workout' } },
        },
        { text: FINAL_TEXT },
      ],
      expect: {
        // Pinned to T0 = 2026-09-20T10:00:00.000Z (see the file comment).
        seen: {
          mustMatch: [
            'RECENT TRAINING HISTORY',
            '- lower_a — 2d ago (Fri) afternoon',
            '- upper_a — 4d ago (Wed)',
            "GREETING: This is the user's first message today",
            '## User Facts',
            'Prefers short, direct replies without long intros',
            '## Previous episodes',
            'The workout plan is ready and pending save',
            // AC-CC-1 (fixed): the one-turn exchange stays verbatim after the gap.
            PAST_HUMAN_TEXT,
            PAST_AI_TEXT,
            // AC-CC-2 (fixed): the gap note before the new message.
            GAP_NOTE_MARKER,
          ],
        },
        tools: { must: ['request_transition'] },
        // The greeting rides the same AI message as the tool call; today the
        // adapter delivers only the last AI text (BUG-018 point 3).
        delivered: { mustMatch: [GREETING_TEXT], knownBug: 'BUG-018/AC-CC-3' },
        persisted: { turnRecorded: true },
        phaseAfter: { phase: 'session_planning' },
      },
    },
  ],
};
