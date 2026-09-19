import type { Scenario } from '../schema/scenario.schema';

import { BENCH_PRESS_ID, setupSteps, sharedPast } from './b-full-workout.scenario';

/**
 * Journey C — an interrupted workout (training-journey-scenarios plan,
 * Task 5 / AC-TJ-2, AC-TJ-3).
 *
 * The same world as journey B (imported, not copied): two completed workouts,
 * an active Upper/Lower split, one fact. The journey reuses B's setup steps
 * (greeting → session_planning → `start_training_session`), logs two bench
 * sets, answers a mid-workout rest question with TEXT ONLY (no tool), then
 * the clock jumps +3.5 h — past `EPISODE_GAP_HOURS` (3 h), so the return run
 * compacts the episode away and the training phase re-reads the session from
 * the DB: STALE SESSION + a WORKOUT OVERVIEW still listing the pre-pause
 * sets. The third set lands as a RETRO set (`skipActivityUpdate`), so
 * `finish_training` completes the session AT the last pre-pause activity —
 * `durationMinutes` measures the trained window (≈11 min), not the wall clock.
 *
 * The two BUG-018 reproductions: the mid-workout exchange not seen verbatim
 * after the pause (AC-CC-1 — the inactivity compaction dropped it) and the
 * missing gap note before "вернулся" (AC-CC-2).
 *
 * The STALE label ("inactive for 3 hours"), the retro marker and the
 * 11-minute duration assume the deterministic layer's pinned T0 —
 * 2026-09-20T10:00:00.000Z (see journey B); the integration test must keep
 * that T0. Set 2 lands at +12m, not +11m: `startedAt` carries ~0.4 s of fake
 * clock drift, so the floor in `durationMinutes` is exactly 11 either way.
 */

/** The step texts — the AC-CC-1 assertions quote the question verbatim. */
export const REST_QUESTION = 'сколько мне отдыхать между подходами жима?';
export const RETURN_TEXT = 'вернулся, доделаю';
export const THIRD_SET_TEXT = 'сделал ещё жим 80 на 8';
export const FINISH_C_REQUEST = 'всё, доделал';

/** The scripted AI replies. */
export const AFTER_SET_1_TEXT = 'Один подход жима записан. Как будет второй — пиши.';
export const AFTER_SET_2_TEXT = 'Два подхода есть, остался один.';
export const REST_ANSWER = 'Между подходами жима отдыхай 2-3 минуты: для силы этого достаточно.';
export const RETURN_REPLY = 'С возвращением! Продолжаем Upper A — остался один подход жима лёжа.';
export const AFTER_THIRD_SET_TEXT = 'Третий подход записан, жим закрыт. Что-нибудь ещё?';
export const FINISH_C_FINAL_TEXT = 'Молодец, что вернулся и доделал! Три подхода жима — тренировка закрыта.';

/**
 * The gap note AC-CC-2 will add before the return message — same shape as
 * journey A's marker, with the measured gap (3.5 h).
 */
export const GAP_NOTE_MARKER = 'The user returns after 3.5 h';

export const scenario: Scenario = {
  id: 'c-interrupted-workout',
  description:
    'an interrupted workout: two sets, a text-only rest question, a +3.5 h pause, a return, a retro set, finish; ' +
    'AC-CC-1 (the exchange lost to inactivity compaction) and AC-CC-2 (no gap note) reproductions',
  past: sharedPast,
  steps: [
    ...setupSteps,
    { action: 'advance', at: '+5m' },
    // --- step 4: bench set 1 ---
    {
      action: 'user',
      text: 'сделал жим 80 на 8',
      script: [
        { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 80 } } },
        { text: AFTER_SET_1_TEXT },
      ],
      expect: {
        seen: {
          mustMatch: [
            '=== WORKOUT OVERVIEW ===',
            'ACTIVE: none — log any set to start an exercise',
          ],
        },
        tools: { must: ['log_set'] },
        delivered: { mustMatch: [AFTER_SET_1_TEXT] },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'in_progress',
            exercises: [{ exercise: 'Barbell Bench Press', sets: [{ reps: 8, weight: 80 }] }],
          },
          turnRecorded: true,
        },
        phaseAfter: { phase: 'training' },
      },
    },
    // +12m, not +11m: `startedAt` (step 2, T0 + ~0.4 s drift) must not eat
    // into the minute `durationMinutes` floors at the retro finish below.
    { action: 'advance', at: '+12m' },
    // --- step 6: bench set 2 ---
    {
      action: 'user',
      text: 'ещё раз 80 на 8',
      script: [
        { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 80 } } },
        { text: AFTER_SET_2_TEXT },
      ],
      expect: {
        seen: {
          mustMatch: [
            `ACTIVE: Barbell Bench Press [ID:${BENCH_PRESS_ID}] — 1 set(s) done, 2 remaining per plan.`,
          ],
        },
        tools: { must: ['log_set'] },
        delivered: { mustMatch: [AFTER_SET_2_TEXT] },
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
          turnRecorded: true,
        },
        phaseAfter: { phase: 'training' },
      },
    },
    // --- step 7: the mid-workout rest question — text only, no tool ---
    {
      action: 'user',
      text: REST_QUESTION,
      script: [{ text: REST_ANSWER }],
      expect: {
        seen: {
          mustMatch: [
            '=== WORKOUT OVERVIEW ===',
            `[IN PROGRESS] [ID:${BENCH_PRESS_ID}] Barbell Bench Press: 3×8-10 @ 80 kg (2/3 sets)`,
            `ACTIVE: Barbell Bench Press [ID:${BENCH_PRESS_ID}] — 2 set(s) done, 1 remaining per plan.`,
          ],
        },
        delivered: { mustMatch: [REST_ANSWER] },
        persisted: { turnRecorded: true },
        phaseAfter: { phase: 'training' },
      },
    },
    // --- step 8: the pause — +3.5 h, past EPISODE_GAP_HOURS (3 h) ---
    { action: 'advance', at: '+3.5h' },
    // --- step 9: the return — the session re-read from the DB, stale ---
    {
      action: 'user',
      text: RETURN_TEXT,
      script: [{ text: RETURN_REPLY }],
      expect: {
        seen: {
          mustMatch: [
            '=== STALE SESSION ===',
            'This session has been inactive for 3 hours.',
            'Retro-logging is active',
            '=== WORKOUT OVERVIEW ===',
            `[IN PROGRESS] [ID:${BENCH_PRESS_ID}] Barbell Bench Press: 3×8-10 @ 80 kg (2/3 sets)`,
            `ACTIVE: Barbell Bench Press [ID:${BENCH_PRESS_ID}] — 2 set(s) done, 1 remaining per plan.`,
            'min ago): 8 reps @ 80 kg',
            // BUG-018 point 1: the 3.5 h gap crossed EPISODE_GAP_HOURS, the
            // inactivity compaction ended the episode, and the rest exchange
            // is gone from the model input.
            { text: REST_QUESTION, knownBug: 'BUG-018/AC-CC-1' },
            { text: REST_ANSWER, knownBug: 'BUG-018/AC-CC-1' },
            // BUG-018 point 2: nothing tells the model time has passed.
            { text: GAP_NOTE_MARKER, knownBug: 'BUG-018/AC-CC-2' },
          ],
        },
        delivered: { mustMatch: [RETURN_REPLY] },
        persisted: {
          session: { key: 'upper_a', status: 'in_progress' },
          turnRecorded: true,
        },
        phaseAfter: { phase: 'training' },
      },
    },
    { action: 'advance', at: '+3.75h' },
    // --- step 11: the third set — retro-logged onto the original window ---
    {
      action: 'user',
      text: THIRD_SET_TEXT,
      script: [
        { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 80 } } },
        { text: AFTER_THIRD_SET_TEXT },
      ],
      expect: {
        seen: {
          mustMatch: [
            'Set 3 logged: 8 reps @ 80 kg (retro-logged).',
          ],
        },
        tools: { must: ['log_set'] },
        delivered: { mustMatch: [AFTER_THIRD_SET_TEXT] },
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
                  { reps: 8, weight: 80 },
                ],
              },
            ],
          },
          turnRecorded: true,
        },
        phaseAfter: { phase: 'training' },
      },
    },
    { action: 'advance', at: '+3.8h' },
    // --- step 13: finish — stale, so completedAt falls back to the last
    // real activity (set 2, +12m) and durationMinutes floors to 11 ---
    {
      action: 'user',
      text: FINISH_C_REQUEST,
      script: [
        { toolCall: { name: 'finish_training', args: { feedback: 'Вернулся и доделал' } } },
        { text: FINISH_C_FINAL_TEXT },
      ],
      expect: {
        tools: { must: ['finish_training'] },
        delivered: { mustMatch: [FINISH_C_FINAL_TEXT] },
        phaseAfter: { phase: 'chat' },
        persisted: {
          session: {
            key: 'upper_a',
            status: 'completed',
            hasCompletedAt: true,
            durationMinutes: 11,
            exercises: [
              {
                exercise: 'Barbell Bench Press',
                sets: [
                  { reps: 8, weight: 80 },
                  { reps: 8, weight: 80 },
                  { reps: 8, weight: 80 },
                ],
              },
            ],
          },
          turnRecorded: true,
        },
      },
    },
  ],
};
