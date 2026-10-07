/**
 * retro-timestamps plan, T2 (BUG-043) — AC-RT-3 and AC-RT-4 over the real test DB, reworked by
 * stale-session-autoclose T1 (BUG-053, owner decision 2026-10-08).
 *
 * The 2026-09-29 shape: the session is created and started at plan acceptance, the user reaches
 * the gym 3 h later, logs 16 sets over 75 minutes, then finishes. Under INV-TRAINING-005 the
 * empty session is 2 h 55 m idle at the first set message, so it is COMPLETED by the timeout
 * auto-close (`auto_close_reason = 'timeout'`, `completed_at` = the last activity, INV-TRAINING-006)
 * and the message is answered in CHAT. The 16-live-sets journey — late-start re-anchoring, live
 * timestamps, `duration_minutes` = 75 — is reachable again only through T2's `reopen_workout`
 * (a reopened session with no sets still late-starts on its first live set); its steps and
 * assertions are parked below, marked `restored in T2 via reopen_workout`.
 *
 * Harness note: `run-scenario.ts` stamps a new session's `last_activity_at` with the scenario
 * clock at the first `advance` step, and live sets get their `created_at` from the DB clock
 * (real time), so set `created_at` is asserted for distinctness only, not against the scripted
 * clock.
 */
import { runScenario, type ScenarioRunResult } from '../../../evals/lib/run-scenario';
import { setupSteps, sharedPast } from '../../../evals/scenarios/b-full-workout.scenario';
import { ScenarioSchema, type Scenario } from '../../../evals/schema/scenario.schema';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

const T0 = new Date('2026-09-25T09:00:00.000Z');
const MIN = 60_000;
/** The gym arrival: 3 h after T0 — the empty session is 2 h 55 m idle at that message. */
const FIRST_SET_AT_MIN = 180;
const GYM_TEXT = 'жим 80 на 10, подход 1';
/** T1's text-only reply: the session closed at this message; the sets wait for T2's reopen. */
const GYM_T1_REPLY = 'Тренировка закрылась после перерыва — подходы допишем позже.';

const steps: Scenario['steps'] = [...setupSteps, { action: 'advance', at: '+5m' }];
steps.push({ action: 'advance', at: `+${FIRST_SET_AT_MIN}m` });
steps.push({ action: 'user', text: GYM_TEXT, script: [{ text: GYM_T1_REPLY }] });
const GYM_STEP_INDEX = steps.length - 1;

// --- restored in T2 via reopen_workout (BUG-053): the gym turn reopens the just-closed session
// (a reopened session with no sets late-starts on its first live set, AC-RT-3), then the 16 live
// sets over 75 minutes and the finish. Keep verbatim for T2 to re-enable:
// const SETS = 16;
// const SET_GAP_MIN = 5;
// const LAST_SET_AT_MIN = FIRST_SET_AT_MIN + (SETS - 1) * SET_GAP_MIN; // 255
// const FINISH_TEXT = 'всё, закончил';
// const FINISH_REPLY = 'Отличная работа!';
// const setStepIndexes: number[] = [];
// for (let i = 0; i < SETS; i++) {
//   steps.push({ action: 'advance', at: `+${FIRST_SET_AT_MIN + i * SET_GAP_MIN}m` });
//   setStepIndexes.push(steps.length);
//   steps.push({
//     action: 'user',
//     text: `жим 80 на 10, подход ${i + 1}`,
//     script: [
//       { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 10, weight: 80 } } },
//       { text: 'Записал!' },
//     ],
//   });
// }
// const FINISH_STEP_INDEX = steps.length;
// steps.push({
//   action: 'user',
//   text: FINISH_TEXT,
//   script: [{ toolCall: { name: 'finish_training', args: {} } }, { text: FINISH_REPLY }],
// });

const scenarioDef: Scenario = {
  id: 'retro-timestamps',
  description:
    'BUG-043/BUG-053: plan accepted, gym 3 h later — the empty idle session auto-closes at the ' +
    'first set message; chat answers it (T1). The live-sets journey returns with T2 reopen_workout',
  past: sharedPast,
  steps,
};

describe('retro-timestamps scenario (BUG-043/BUG-053, AC-RT-3/AC-RT-4 reworked for T1)', () => {
  let result: ScenarioRunResult;
  let model: ScriptedModelHandle;

  beforeAll(async () => {
    expect(ScenarioSchema.parse(scenarioDef)).toBeTruthy();
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);
    model = installScriptedModel();
    for (const step of scenarioDef.steps) {
      if (step.action === 'user') {
        model.enqueueChat(step.script ?? []);
      }
    }
    result = await runScenario(scenarioDef, { onAdvance: now => jest.setSystemTime(now) });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  /** The workout session of this journey (newest first in every snapshot). */
  const finalSession = () => result.steps[GYM_STEP_INDEX]!.sessions[0]!;
  const gymObservation = () => result.steps[GYM_STEP_INDEX]!;

  it('the journey ran without tools (the set could not be logged in T1)', () => {
    expect(gymObservation().runRow?.toolCalls ?? []).toEqual([]);
    expect(gymObservation().delivered).toBe(GYM_T1_REPLY);
  });

  it('the idle empty session is completed with auto_close_reason = timeout at the gym message', () => {
    expect(finalSession().status).toBe('completed');
    expect(finalSession().autoCloseReason).toBe('timeout');
  });

  it('completed_at = the clamped last activity — never before started_at, never the +3 h gym clock', () => {
    const { completedAt, lastActivityAt, startedAt } = finalSession();
    // BUG-043 clamp: a never-started session's last activity can precede
    // started_at by ~1 s of harness drift, so the close is dated to the later
    // of the two — still the creation moment, not the return clock.
    const expected = Math.max(lastActivityAt!.getTime(), startedAt!.getTime());
    expect(completedAt!.getTime()).toBe(expected);
    expect(Math.abs(expected - T0.getTime())).toBeLessThan(2 * MIN);
  });

  it('no set was persisted (the 16 live sets wait for T2 reopen_workout)', () => {
    expect(finalSession().exercises.flatMap(ex => ex.sets)).toEqual([]);
  });

  it('the phase after the gym message is chat', () => {
    expect(gymObservation().phase).toBe('chat');
  });

  it('consumed the whole script (no fallback answer leaked in)', () => {
    expect(model.chatScriptExhausted).toBe(true);
  });

  // --- restored in T2 via reopen_workout (BUG-053): the AC-RT-3/AC-RT-4 assertions of the
  // 16-live-sets journey. Keep verbatim for T2 to re-enable (against the finish step):
  // it('AC-RT-3: all 16 sets are saved with distinct, strictly increasing created_at (not one frozen retro stamp)', () => {
  //   const sets = finalSession().exercises.flatMap(ex => ex.sets);
  //   expect(sets).toHaveLength(SETS);
  //   const stamps = sets.map(s => s.createdAt.getTime());
  //   expect(new Set(stamps).size).toBe(SETS);
  //   for (let i = 1; i < stamps.length; i++) {
  //     expect(stamps[i]!).toBeGreaterThan(stamps[i - 1]!);
  //   }
  // });
  // it('AC-RT-3: started_at is the first set (~T0+180m), not plan acceptance', () => {
  //   const startedAt = finalSession().startedAt!.getTime();
  //   expect(Math.abs(startedAt - (T0.getTime() + FIRST_SET_AT_MIN * MIN))).toBeLessThan(2 * MIN);
  // });
  // it('AC-RT-3: last_activity_at is the last set (~T0+255m)', () => {
  //   const lastActivityAt = finalSession().lastActivityAt.getTime();
  //   expect(Math.abs(lastActivityAt - (T0.getTime() + LAST_SET_AT_MIN * MIN))).toBeLessThan(2 * MIN);
  // });
  // it('AC-RT-3: completed_at is not before started_at and is at/after the last set', () => {
  //   const { startedAt, completedAt } = finalSession();
  //   expect(completedAt!.getTime()).toBeGreaterThanOrEqual(startedAt!.getTime());
  //   expect(completedAt!.getTime()).toBeGreaterThanOrEqual(T0.getTime() + LAST_SET_AT_MIN * MIN - MIN);
  // });
  // it('AC-RT-3: duration_minutes is 75 ± 1', () => {
  //   const duration = finalSession().durationMinutes;
  //   expect(duration).toBeGreaterThanOrEqual(74);
  //   expect(duration).toBeLessThanOrEqual(76);
  // });
  // it('AC-RT-4: no set confirmation the model saw says "retro-logged"', () => {
  //   const retroSteps = setStepIndexes.filter(i => (seenByStep.get(i) ?? '').includes('retro-logged'));
  //   expect(retroSteps).toEqual([]);
  // });
  // it('AC-RT-4: the STALE SESSION block is gone from the prompt of every run after the first live set', () => {
  //   const staleSteps = setStepIndexes.slice(1).filter(i => (seenByStep.get(i) ?? '').includes('=== STALE SESSION ==='));
  //   expect(staleSteps).toEqual([]);
  // });
});
