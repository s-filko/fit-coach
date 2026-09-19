import type { Scenario } from '../schema/scenario.schema';

import { BENCH_PRESS_ID, PULL_UPS_ID, setupSteps, sharedPast } from './b-full-workout.scenario';

/**
 * Journey C — catch-up logging after a pause (training-journey-scenarios plan,
 * Task 5b / AC-TJ-2, AC-TJ-3; owner ruling 2026-09-20).
 *
 * The same world as journey B (imported, not copied): two completed workouts,
 * an active Upper/Lower split, one fact. The journey reuses B's setup steps
 * (greeting → session_planning → `start_training_session`), logs two bench
 * sets, answers a mid-workout rest question with TEXT ONLY (no tool), then
 * the clock jumps +3.5 h — past `EPISODE_GAP_HOURS` (3 h), so the return run
 * compacts the episode away and the training phase re-reads the session from
 * the DB: STALE SESSION + a WORKOUT OVERVIEW still listing the pre-pause
 * sets.
 *
 * Per the owner ruling, a >2 h gap means the user is CATCHING UP an old
 * workout later ("ушёл в спешке и забыл дописать"), not continuing it — the
 * retro behaviour below is CORRECT, and what the old Task 5 scenario got
 * wrong was its user text ("вернулся, доделаю" depicts continuing). So after
 * the pause the user logs the missed pull-ups in one message — implicitly
 * ("забыл дописать…") or explicitly ("добавь к последней тренировке…"); the
 * two variants share every step except that one user text. The three sets
 * land as RETRO sets (`skipActivityUpdate`, timestamped at the last activity
 * + `RETRO_SET_OFFSET_MS`), so `finish_training` completes the session AT the
 * last pre-pause activity — `durationMinutes` measures the trained window
 * (≈11 min), not the wall clock.
 *
 * The two BUG-018 reproductions: the mid-workout exchange not seen verbatim
 * after the pause (AC-CC-1 — the inactivity compaction dropped it) and the
 * missing gap note before the catch-up message (AC-CC-2). The `liveOnly`
 * delivered entries (Task 5b) carry the L3 expectation — a REAL reply must
 * say the sets went to the PREVIOUS workout and ask whether to close it or
 * add more; the deterministic layer skips them (its delivered text is just
 * the script below).
 *
 * The STALE label ("inactive for 3 hours"), the retro marker and the
 * 11-minute duration assume the deterministic layer's pinned T0 —
 * 2026-09-20T10:00:00.000Z (see journey B); the integration test must keep
 * that T0. Set 2 lands at +12m, not +11m: `startedAt` carries ~0.4 s of fake
 * clock drift, so the floor in `durationMinutes` is exactly 11 either way.
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
/** The catch-up reply the owner ruling asks of a real model (L3 shape). */
export const CATCH_UP_REPLY_TEXT = 'Записал подтягивания 3×8 к предыдущей тренировке. Закрыть её или добавить ещё?';
export const FINISH_C_FINAL_TEXT = 'Закрыл! Жим и подтягивания записаны — 11 минут работы.';

/**
 * The gap note AC-CC-2 will add before the catch-up message — same shape as
 * journey A's marker, with the measured gap (3.5 h).
 */
export const GAP_NOTE_MARKER = 'The user returns after 3.5 h';

/** The catch-up reply markers the live L3 layer checks (delivered, liveOnly). */
export const LIVE_ADDED_TO_PREVIOUS_MARKER = 'к предыдущей тренировке';
export const LIVE_CLOSE_OR_ADD_MARKER = 'закрыть её или добавить';

/** Both bench sets — what the session holds when the user catches up. */
const BENCH_TWO_SETS = [{ reps: 8, weight: 80 }, { reps: 8, weight: 80 }];

/** The scripted catch-up turn: three retro pull-up sets, then the ruling's reply. */
type UserStep = Extract<Scenario['steps'][number], { action: 'user' }>;
const catchUpScript: NonNullable<UserStep['script']> = [
  { toolCall: { name: 'log_set', args: { exerciseId: PULL_UPS_ID, reps: 8 } } },
  { toolCall: { name: 'log_set', args: { exerciseId: PULL_UPS_ID, reps: 8 } } },
  { toolCall: { name: 'log_set', args: { exerciseId: PULL_UPS_ID, reps: 8 } } },
  { text: CATCH_UP_REPLY_TEXT },
];

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
      // --- step 9: the catch-up — the session re-read from the DB, stale;
      // the three pull-up sets land RETRO in the PREVIOUS session window ---
      {
        action: 'user',
        text: catchUpText,
        script: catchUpScript,
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
              '(retro-logged).',
              // AC-CC-1 (fixed): the rest exchange stays verbatim after the gap.
              REST_QUESTION,
              REST_ANSWER,
              // BUG-018 point 2: nothing tells the model time has passed.
              { text: GAP_NOTE_MARKER, knownBug: 'BUG-018/AC-CC-2' },
            ],
          },
          tools: { must: ['log_set'] },
          // L3 only: a REAL reply must name the previous workout and ask
          // whether to close it or add more (owner ruling). The deterministic
          // layer skips these — its delivered text is the script's.
          delivered: {
            mustMatch: [
              CATCH_UP_REPLY_TEXT,
              { text: LIVE_ADDED_TO_PREVIOUS_MARKER, liveOnly: true },
              { text: LIVE_CLOSE_OR_ADD_MARKER, liveOnly: true },
            ],
          },
          persisted: {
            session: {
              key: 'upper_a',
              status: 'in_progress',
              exercises: [
                { exercise: 'Barbell Bench Press', sets: BENCH_TWO_SETS },
                { exercise: 'Pull-ups', sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
              ],
            },
            turnRecorded: true,
          },
          phaseAfter: { phase: 'training' },
        },
      },
      { action: 'advance', at: '+3.55h' },
      // --- step 11: finish — stale, so completedAt falls back to the last
      // real activity (set 2, +12m) and durationMinutes floors to 11 ---
      {
        action: 'user',
        text: FINISH_C_REQUEST,
        script: [
          { toolCall: { name: 'finish_training', args: { feedback: 'Дописал подтягивания позже' } } },
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
                { exercise: 'Barbell Bench Press', sets: BENCH_TWO_SETS },
                { exercise: 'Pull-ups', sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
              ],
            },
            turnRecorded: true,
          },
        },
      },
    ],
  };
}

/** Journey C, implicit catch-up: "забыл дописать…" (Task 5b). */
export const scenario: Scenario = buildCatchUpScenario(
  'c-catch-up-logging',
  'catch-up logging after a +3.5 h pause: two sets, a text-only rest question, then the missed pull-ups ' +
    'logged retro into the previous session; AC-CC-1 (the exchange lost to inactivity compaction) and ' +
    'AC-CC-2 (no gap note) reproductions',
  IMPLICIT_CATCH_UP_TEXT,
);

/** Journey C, explicit catch-up: "добавь к последней тренировке…" — same persisted outcome. */
export const explicitScenario: Scenario = buildCatchUpScenario(
  'c-catch-up-explicit',
  'the explicit catch-up wording: "добавь к последней тренировке" after the same +3.5 h pause — ' +
    'identical steps and the same persisted outcome as the implicit variant',
  EXPLICIT_CATCH_UP_TEXT,
);
