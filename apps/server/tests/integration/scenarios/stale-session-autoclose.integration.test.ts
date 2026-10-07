/**
 * Stale session auto-close over the real stack (BUG-053, stale-session-autoclose plan T1 /
 * AC-SSA-1): a workout left in_progress goes idle past SESSION_TIMEOUT_MS (2 h); the user's
 * NEXT message — an ordinary «привет», not a training request — closes it through the timeout
 * auto-close path (status 'completed', `auto_close_reason = 'timeout'`, `completed_at` = the
 * last activity, INV-TRAINING-006) and is itself answered by the CHAT phase: the delivered
 * text is the scripted chat reply, no `session_ended_return_to_chat` catalog text, no tool
 * call. Journey B's setup (imported) reaches a live training session; one bench set pins the
 * activity moment; a +3.5 h advance (T0-relative, activity was at +5 m) crosses the timeout
 * with room for the harness' clock stamps.
 */
import { runScenario, type ScenarioRunResult, type ScenarioStepObservation } from '../../../evals/lib/run-scenario';
import { ScenarioSchema, type Scenario } from '../../../evals/schema/scenario.schema';
import { BENCH_PRESS_ID, setupSteps, sharedPast } from '../../../evals/scenarios/b-full-workout.scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

/** Pinned so the idle arithmetic (last activity +5 m, advance +3 h 20 m) stays exact. */
const T0 = new Date('2026-10-08T10:00:00.000Z');
const SET_TEXT = 'сделал жим 80 на 8';
const SET_REPLY = 'Записал! Как будет второй — пиши.';
const RETURN_TEXT = 'привет';
const RETURN_REPLY = 'Привет! Давно не виделись.';

const scenario: Scenario = {
  id: 'stale-session-autoclose',
  description:
    'BUG-053: a workout idle past 2 h closes at the user’s next message; chat answers it (AC-SSA-1)',
  past: sharedPast,
  steps: [
    ...setupSteps,
    // --- step 3: +5 m — stamps the session's creation to the scenario clock ---
    { action: 'advance', at: '+5m' },
    // --- step 4: one bench set — the session's last activity lands at +5 m ---
    {
      action: 'user',
      text: SET_TEXT,
      script: [
        { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 80 } } },
        { text: SET_REPLY },
      ],
    },
    // --- step 5: +3.5 h (T0-relative) — idle 3 h 25 m > 2 h ---
    { action: 'advance', at: '+3.5h' },
    // --- step 6: the return message — the stale session closes, chat answers ---
    { action: 'user', text: RETURN_TEXT, script: [{ text: RETURN_REPLY }] },
  ],
};

const RETURN_STEP = 6;

describe('stale session auto-close (BUG-053, AC-SSA-1) — one message over the real stack', () => {
  let result: ScenarioRunResult;
  let model: ScriptedModelHandle;

  beforeAll(async () => {
    expect(ScenarioSchema.parse(scenario)).toBeTruthy(); // the scenario is format-valid
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);
    model = installScriptedModel();
    for (const step of scenario.steps) {
      if (step.action === 'user') {
        model.enqueueChat(step.script ?? []);
      }
    }
    result = await runScenario(scenario, { onAdvance: now => jest.setSystemTime(now) });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const observationOf = (index: number): ScenarioStepObservation => {
    const obs = result.steps[index];
    if (!obs || obs.action !== 'user') {
      throw new Error(`stale-session-autoclose: no user-step observation at index ${index}`);
    }
    return obs;
  };

  /** The journey's upper_a session (newest-first; the seeded −4 d one is older). */
  const upperAOf = (index: number) => {
    const [current] = observationOf(index).sessions.filter(s => s.sessionKey === 'upper_a');
    if (!current) {
      throw new Error('stale-session-autoclose: no upper_a session in the step snapshot');
    }
    return current;
  };

  it('the set landed: the session is in_progress before the pause', () => {
    const before = upperAOf(4);
    expect(before.status).toBe('in_progress');
    expect(before.exercises.flatMap(ex => ex.sets)).toHaveLength(1);
  });

  it('the idle session is completed with auto_close_reason = timeout after one message', () => {
    const session = upperAOf(RETURN_STEP);
    expect(session.status).toBe('completed');
    expect(session.autoCloseReason).toBe('timeout');
  });

  it('completed_at = last_activity_at (the close is dated to the last activity, not the return)', () => {
    const session = upperAOf(RETURN_STEP);
    expect(session.completedAt?.getTime()).toBe(session.lastActivityAt?.getTime());
    // And that moment is the bench set (+5 m), long before the return (+3 h 20 m).
    expect(session.completedAt?.getTime()).toBeLessThan(result.t0.getTime() + 3 * 60 * 60 * 1000);
  });

  it('the phase after the return message is chat', () => {
    expect(observationOf(RETURN_STEP).phase).toBe('chat');
  });

  it('the delivered text is the scripted chat reply, not the session_ended catalog text', () => {
    const delivered = observationOf(RETURN_STEP).delivered;
    expect(delivered).toBe(RETURN_REPLY);
    expect(delivered).not.toContain('Тренировка завершена');
    expect(delivered).not.toContain('training session has been completed');
  });

  it('the return turn ran no tool (a text-only chat answer)', () => {
    expect(observationOf(RETURN_STEP).runRow?.toolCalls ?? []).toEqual([]);
  });

  it('consumed the whole script (no fallback answer leaked in)', () => {
    expect(model.chatScriptExhausted).toBe(true);
  });
});
