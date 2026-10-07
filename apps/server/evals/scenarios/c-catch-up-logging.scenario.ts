import type { Scenario } from '../schema/scenario.schema';

import { BENCH_PRESS_ID, setupSteps, sharedPast } from './b-full-workout.scenario';

/**
 * Journey C — catch-up logging after a pause (training-journey-scenarios plan,
 * Task 5b / AC-TJ-2, AC-TJ-3; owner ruling 2026-09-20).
 *
 * The same world as journey B (imported, not copied): two completed workouts,
 * an active Upper/Lower split, one fact. The journey reuses B's setup steps
 * (greeting → session_planning → `start_training_session`), logs two bench
 * sets, answers a mid-workout rest question with TEXT ONLY (no tool), then
 * the clock jumps +3.5 h — past `EPISODE_GAP_HOURS` (3 h) and past the
 * 2 h session timeout, so the return run compacts the episode away.
 *
 * BUG-053 (stale-session-autoclose plan T1, owner decision 2026-10-08 — it
 * supersedes the 2026-09-20 ruling's still-open-session shape): at the
 * catch-up message the stale session is COMPLETED by the timeout auto-close
 * (`auto_close_reason = 'timeout'`, `completed_at` = the last pre-pause
 * activity) and the message is answered in CHAT. The missed pull-ups land in
 * the workout again only through `reopen_workout` — that block of steps is
 * kept below, disabled, marked `restored in T2 via reopen_workout`, with its
 * original intent (retro sets timestamped at the last activity +
 * `RETRO_SET_OFFSET_MS`, `finish_training` closing AT the last activity —
 * `durationMinutes` ≈ 11, the trained window, not the wall clock).
 *
 * Former BUG-018 reproductions, now fixed (Tasks 1-2): the mid-workout
 * exchange stays verbatim after the pause (AC-CC-1) and the gap note sits
 * before the catch-up message (AC-CC-2).
 *
 * The STALE label ("inactive for 3 hours") and the 11-minute duration assume
 * the deterministic layer's pinned T0 — 2026-09-20T10:00:00.000Z (see
 * journey B); the integration test must keep that T0. Set 2 lands at +12m,
 * not +11m: `startedAt` carries ~0.4 s of fake clock drift, so the floor in
 * `durationMinutes` is exactly 11 either way.
 */

/** The step texts — the AC-CC-1 assertions quote the question verbatim. */
export const REST_QUESTION = 'сколько мне отдыхать между подходами жима?';
export const IMPLICIT_CATCH_UP_TEXT = 'забыл дописать: последнее упражнение — подтягивания 3×8';
export const EXPLICIT_CATCH_UP_TEXT = 'добавь к последней тренировке: подтягивания 3×8';
export const FINISH_C_REQUEST = 'всё, закрой тренировку';

/** The scripted AI replies. */
export const AFTER_SET_1_TEXT = 'Один подход жима записан. Как будет второй — пиши.';
export const AFTER_SET_2_TEXT = 'Два подхода есть, остался один.';
export const REST_ANSWER = 'Между подходами жима отдыхай 2-3 минуты: для силы этого достаточно.';
/**
 * The T1 catch-up reply (text only): BUG-053 auto-closes the stale session at this message and
 * chat answers it — no set can be logged into it until T2's `reopen_workout`.
 */
export const CATCH_UP_T1_TEXT = 'Тренировка закрылась после перерыва. Подтягивания допишем к ней позже.';
/** The catch-up reply the T2 reopen flow asks of a real model (L3 shape). */
export const CATCH_UP_REPLY_TEXT = 'Записал подтягивания 3×8 к предыдущей тренировке. Закрыть её или добавить ещё?';
export const FINISH_C_FINAL_TEXT = 'Закрыл! Жим и подтягивания записаны — 11 минут работы.';

/**
 * The gap note AC-CC-2 places before the catch-up message (fixed, Task 2) —
 * same shape as journey A's marker, with the measured gap (3.5 h).
 */
export const GAP_NOTE_MARKER = 'The user returns after 3.5 h';

/** The catch-up reply markers the live L3 layer checks (delivered, liveOnly). */
export const LIVE_ADDED_TO_PREVIOUS_MARKER = 'к предыдущей тренировке';
export const LIVE_CLOSE_OR_ADD_MARKER = 'закрыть её или добавить';

/** Both bench sets — what the session holds when the user catches up. */
const BENCH_TWO_SETS = [
  { reps: 8, weight: 80 },
  { reps: 8, weight: 80 },
];

/**
 * The scripted catch-up turn in T1 (BUG-053): the stale session auto-closes at this message and
 * chat answers with text only. The retro-logging turn below is what T2's `reopen_workout`
 * restores.
 */
type UserStep = Extract<Scenario['steps'][number], { action: 'user' }>;
const catchUpScript: NonNullable<UserStep['script']> = [{ text: CATCH_UP_T1_TEXT }];

// --- restored in T2 via reopen_workout (BUG-053): the three catch-up sets land RETRO in the
// reopened previous session, then the ruling's reply. Keep verbatim for T2 to re-enable:
// const catchUpScript: NonNullable<UserStep['script']> = [
//   { toolCall: { name: 'log_set', args: { exerciseId: PULL_UPS_ID, reps: 8 } } },
//   { toolCall: { name: 'log_set', args: { exerciseId: PULL_UPS_ID, reps: 8 } } },
//   { toolCall: { name: 'log_set', args: { exerciseId: PULL_UPS_ID, reps: 8 } } },
//   { text: CATCH_UP_REPLY_TEXT },
// ];

/**
 * Builds the whole journey around one catch-up wording — the two variants
 * share every step (and every assertion) except that user text, so the
 * persisted outcome cannot drift between them.
 */
function buildCatchUpScenario(id: string, description: string, catchUpText: string): Scenario {
  return {
    id,
    description,
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
              '# Today (sets as reps×kg)',
              `- Barbell Bench Press [id ${BENCH_PRESS_ID}] — plan 3×8-10 — nothing yet`,
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
            mustMatch: [`- Barbell Bench Press [id ${BENCH_PRESS_ID}] — plan 3×8-10 — in progress: 8×80`],
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
                  sets: BENCH_TWO_SETS,
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
            mustMatch: [`- Barbell Bench Press [id ${BENCH_PRESS_ID}] — plan 3×8-10 — in progress: 8×80, 8×80`],
          },
          delivered: { mustMatch: [REST_ANSWER] },
          persisted: { turnRecorded: true },
          phaseAfter: { phase: 'training' },
        },
      },
      // --- step 8: the pause — 3.5 h of SILENCE since the rest exchange at
      // +12m, past EPISODE_GAP_HOURS (3 h) and past the 2 h session timeout;
      // the advance anchor is T0-relative, hence +3.7h (AC-CC-2 measures from
      // the previous message, not T0). ---
      { action: 'advance', at: '+3.7h' },
      // --- step 9: the catch-up message — BUG-053 (INV-TRAINING-005): the
      // stale session is completed by the timeout auto-close (completed_at =
      // the last pre-pause activity) and CHAT answers the message; no set is
      // logged into it until T2's reopen_workout. ---
      {
        action: 'user',
        text: catchUpText,
        script: catchUpScript,
        expect: {
          tools: { mustNot: ['log_set'] },
          delivered: { mustMatch: [CATCH_UP_T1_TEXT] },
          persisted: {
            session: { key: 'upper_a', status: 'completed', hasCompletedAt: true },
            turnRecorded: true,
          },
          phaseAfter: { phase: 'chat' },
        },
      },
      // --- restored in T2 via reopen_workout (BUG-053): the reopen turn and the finish —
      // `reopen_workout` returns the just-closed session to training, the three pull-up sets
      // land RETRO (last activity + RETRO_SET_OFFSET_MS), and `finish_training` completes it
      // AT the last pre-pause activity (durationMinutes floors to 11). Keep verbatim for T2
      // to re-enable (the reopen tool call goes on the step-9 script's model turn):
      // { action: 'advance', at: '+3.75h' },
      // {
      //   action: 'user',
      //   text: FINISH_C_REQUEST,
      //   script: [
      //     { toolCall: { name: 'finish_training', args: { feedback: 'Дописал подтягивания позже' } } },
      //     { text: FINISH_C_FINAL_TEXT },
      //   ],
      //   expect: {
      //     tools: { must: ['finish_training'] },
      //     delivered: { mustMatch: [FINISH_C_FINAL_TEXT] },
      //     phaseAfter: { phase: 'chat' },
      //     persisted: {
      //       session: {
      //         key: 'upper_a',
      //         status: 'completed',
      //         hasCompletedAt: true,
      //         durationMinutes: 11,
      //         exercises: [
      //           { exercise: 'Barbell Bench Press', sets: BENCH_TWO_SETS },
      //           { exercise: 'Pull-ups', sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
      //         ],
      //       },
      //       turnRecorded: true,
      //     },
      //   },
      // },
    ],
  };
}

/** Journey C, implicit catch-up: "забыл дописать…" (Task 5b). */
export const scenario: Scenario = buildCatchUpScenario(
  'c-catch-up-logging',
  'catch-up logging after a +3.5 h pause: two sets, a text-only rest question, then the missed pull-ups ' +
    'logged retro into the previous session; AC-CC-1 and AC-CC-2 fixed (Tasks 1-2)',
  IMPLICIT_CATCH_UP_TEXT,
);

/** Journey C, explicit catch-up: "добавь к последней тренировке…" — same persisted outcome. */
export const explicitScenario: Scenario = buildCatchUpScenario(
  'c-catch-up-explicit',
  'the explicit catch-up wording: "добавь к последней тренировке" after the same +3.5 h pause — ' +
    'identical steps and the same persisted outcome as the implicit variant',
  EXPLICIT_CATCH_UP_TEXT,
);
