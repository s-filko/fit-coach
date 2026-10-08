/**
 * retro-timestamps plan, T2 (BUG-043) — over the real test DB, in the BUG-053 shape
 * (stale-session-autoclose plan T5, owner decision 2026-10-08).
 *
 * The 2026-09-29 shape: the session is created and started at plan acceptance, the user reaches
 * the gym 3 h later. Under INV-TRAINING-005 the empty session is 2 h 55 m idle at the first set
 * message, so it is COMPLETED by the timeout auto-close (`auto_close_reason = 'timeout'`,
 * `completed_at` = the last activity, INV-TRAINING-006) and the message is answered in CHAT. The
 * set the user reports is added to that finished workout in place by `edit_last_workout`
 * (BR-TRAINING-030): it carries the retro timestamp (last activity + `RETRO_SET_OFFSET_MS`), and
 * the workout stays completed with its times unchanged. A finished workout is never reopened, so
 * the live 16-set journey of the earlier shapes (late-start re-anchoring, `duration_minutes` = 75)
 * has no path any more: the sets of a new workout belong to a new session.
 *
 * Harness note: `run-scenario.ts` stamps a new session's `last_activity_at` with the scenario
 * clock at the first `advance` step.
 */
import { RETRO_SET_OFFSET_MS } from '@domain/training/session-timing';

import { runScenario, type ScenarioRunResult } from '../../../evals/lib/run-scenario';
import { BENCH_PRESS_ID, setupSteps, sharedPast } from '../../../evals/scenarios/b-full-workout.scenario';
import { ScenarioSchema, type Scenario } from '../../../evals/schema/scenario.schema';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

const T0 = new Date('2026-09-25T09:00:00.000Z');
const MIN = 60_000;
/** The gym arrival: 3 h after T0 — the empty session is 2 h 55 m idle at that message. */
const FIRST_SET_AT_MIN = 180;
const GYM_TEXT = 'жим 80 на 10, подход 1';
/** The reply after the set was added to the finished workout. */
const GYM_REPLY = 'Тренировка закрылась после перерыва; подход жима добавил к ней.';

const steps: Scenario['steps'] = [...setupSteps, { action: 'advance', at: '+5m' }];
steps.push({ action: 'advance', at: `+${FIRST_SET_AT_MIN}m` });
steps.push({
  action: 'user',
  text: GYM_TEXT,
  script: [
    {
      toolCall: {
        name: 'edit_last_workout',
        args: { action: 'add', exerciseId: BENCH_PRESS_ID, reps: 10, weight: 80 },
      },
    },
    { text: GYM_REPLY },
  ],
});
const GYM_STEP_INDEX = steps.length - 1;

const scenarioDef: Scenario = {
  id: 'retro-timestamps',
  description:
    'BUG-043/BUG-053: plan accepted, gym 3 h later — the empty idle session auto-closes at the ' +
    'first set message; chat adds the set to that finished workout with edit_last_workout (T5)',
  past: sharedPast,
  steps,
};

describe('retro-timestamps scenario (BUG-043/BUG-053, reworked for T5)', () => {
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

  it('the gym turn adds the set with edit_last_workout (no log_set), reply delivered', () => {
    const tools = gymObservation().runRow?.toolCalls?.map(c => c.name) ?? [];
    expect(tools).toEqual(['edit_last_workout']);
    expect(gymObservation().delivered).toBe(GYM_REPLY);
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

  it('the set is in the finished workout, dated to the workout (last activity + the retro offset), times unchanged', () => {
    const sets = finalSession().exercises.flatMap(ex => ex.sets);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.setData).toMatchObject({ type: 'strength', reps: 10, weight: 80 });
    expect(sets[0]!.createdAt.getTime()).toBe(finalSession().lastActivityAt!.getTime() + RETRO_SET_OFFSET_MS);
    expect(finalSession().status).toBe('completed');
  });

  it('the phase after the gym message is chat', () => {
    expect(gymObservation().phase).toBe('chat');
  });

  it('consumed the whole script (no fallback answer leaked in)', () => {
    expect(model.chatScriptExhausted).toBe(true);
  });
});
