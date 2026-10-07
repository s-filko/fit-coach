/**
 * retro-timestamps plan, T2 (BUG-043) — AC-RT-3 and AC-RT-4 over the real test DB, in the
 * BUG-053 shape (stale-session-autoclose plan T2, owner decision 2026-10-08).
 *
 * The 2026-09-29 shape: the session is created and started at plan acceptance, the user reaches
 * the gym 3 h later, logs 16 sets over 75 minutes, then finishes. Under INV-TRAINING-005 the
 * empty session is 2 h 55 m idle at the first set message, so prepare COMPLETES it by the
 * timeout auto-close — and the catch-up turn REOPENS it: `reopen_workout` hands the run to
 * training (hence `TRANSITION_HANDOFF_TARGETS` in beforeAll), the reopened session has no sets,
 * so its first live set is a LATE START — `started_at` re-anchors there and all 16 timestamps
 * are LIVE (AC-RT-3); the reopen does not touch `last_activity_at`, and the timeout measures
 * idleness from `max(last_activity_at, reopened_at)`, so the reopened workout stays open for
 * the whole 75-minute window instead of being auto-closed at the next message.
 *
 * Harness note: `run-scenario.ts` stamps a new session's `last_activity_at` with the scenario
 * clock at the first `advance` step, and live sets get their `created_at` from the DB clock
 * (real time), so set `created_at` is asserted for distinctness only, not against the scripted
 * clock.
 */
import type { BaseMessage } from '@langchain/core/messages';

import { runScenario, type ScenarioRunResult, type ScenarioStepObservation } from '../../../evals/lib/run-scenario';
import { BENCH_PRESS_ID, setupSteps, sharedPast } from '../../../evals/scenarios/b-full-workout.scenario';
import { ScenarioSchema, type Scenario } from '../../../evals/schema/scenario.schema';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

import { textOnly } from '@infra/ai/message-text';

const T0 = new Date('2026-09-25T09:00:00.000Z');
const MIN = 60_000;
const SETS = 16;
/** The gym arrival: 3 h after T0 — the empty session is 2 h 55 m idle at that message. */
const FIRST_SET_AT_MIN = 180;
const SET_GAP_MIN = 5;
const LAST_SET_AT_MIN = FIRST_SET_AT_MIN + (SETS - 1) * SET_GAP_MIN; // 255
const FINISH_TEXT = 'всё, закончил';
const FINISH_REPLY = 'Отличная работа!';

const steps: Scenario['steps'] = [...setupSteps, { action: 'advance', at: '+5m' }];
// --- step 4 (+180 m): the gym turn — the auto-closed empty session reopens (BUG-053 T2),
// the first set of the reopened empty session is a late start, so all timestamps stay live. ---
const GYM_STEP_INDEX = steps.length + 1;
steps.push({ action: 'advance', at: `+${FIRST_SET_AT_MIN}m` });
steps.push({
  action: 'user',
  text: 'жим 80 на 10, подход 1',
  script: [
    { toolCall: { name: 'reopen_workout', args: {} } },
    { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 10, weight: 80 } } },
    { text: 'Записал! Начинай.' },
  ],
});
const setStepIndexes: number[] = [GYM_STEP_INDEX];
for (let i = 1; i < SETS; i++) {
  steps.push({ action: 'advance', at: `+${FIRST_SET_AT_MIN + i * SET_GAP_MIN}m` });
  setStepIndexes.push(steps.length);
  steps.push({
    action: 'user',
    text: `жим 80 на 10, подход ${i + 1}`,
    script: [
      { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 10, weight: 80 } } },
      { text: 'Записал!' },
    ],
  });
}
const FINISH_STEP_INDEX = steps.length;
steps.push({
  action: 'user',
  text: FINISH_TEXT,
  script: [{ toolCall: { name: 'finish_training', args: {} } }, { text: FINISH_REPLY }],
});

const scenarioDef: Scenario = {
  id: 'retro-timestamps',
  description:
    'BUG-043/BUG-053: plan accepted, gym 3 h later — the empty idle session auto-closes at the first ' +
    'set message, reopen_workout returns it to training, and the 16 sets are LIVE (late start)',
  past: sharedPast,
  steps,
};

function textOf(m: BaseMessage): string {
  return textOnly(m.content) ?? JSON.stringify(m.content);
}

describe('retro-timestamps scenario (BUG-043/BUG-053, AC-RT-3, AC-RT-4)', () => {
  let result: ScenarioRunResult;
  let model: ScriptedModelHandle;
  const seenByStep = new Map<number, string>();
  let previousHandoff: string | undefined;

  beforeAll(async () => {
    expect(ScenarioSchema.parse(scenarioDef)).toBeTruthy();
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);
    // BUG-053 T2: the gym turn reopens the auto-closed workout in chat and hands
    // the SAME run to training (reopen_workout → training).
    previousHandoff = process.env.TRANSITION_HANDOFF_TARGETS;
    process.env.TRANSITION_HANDOFF_TARGETS = 'training,session_planning';
    model = installScriptedModel();
    for (const step of scenarioDef.steps) {
      if (step.action === 'user') {
        model.enqueueChat(step.script ?? []);
      }
    }
    result = await runScenario(scenarioDef, {
      onAdvance: now => jest.setSystemTime(now),
      onStep: (obs: ScenarioStepObservation) => {
        if (obs.action === 'user') {
          seenByStep.set(obs.stepIndex, model.drainChatInputs().flat().map(textOf).join('\n'));
        }
      },
    });
  });

  afterAll(() => {
    jest.useRealTimers();
    if (previousHandoff === undefined) {
      delete process.env.TRANSITION_HANDOFF_TARGETS;
    } else {
      process.env.TRANSITION_HANDOFF_TARGETS = previousHandoff;
    }
  });

  /** The workout session of this journey (newest first in every snapshot). */
  const finalSession = () => result.steps[FINISH_STEP_INDEX]!.sessions[0]!;

  it('the gym turn reopens the auto-closed empty session (reopen_workout → training)', () => {
    const gym = result.steps[GYM_STEP_INDEX]!;
    const tools = gym.runRow?.toolCalls?.map(c => c.name) ?? [];
    expect(tools).toContain('reopen_workout');
    expect(tools.indexOf('reopen_workout')).toBeLessThan(tools.indexOf('log_set'));
    expect(gym.phase).toBe('training');
    const session = gym.sessions[0]!;
    expect(session.status).toBe('in_progress');
    expect(session.reopenedAt).not.toBeNull();
  });

  it('the journey ran to the end (finish_training recorded)', () => {
    expect(result.steps[FINISH_STEP_INDEX]!.runRow?.toolCalls?.map(c => c.name)).toContain('finish_training');
    expect(finalSession().status).toBe('completed');
  });

  it('AC-RT-3: all 16 sets are saved with distinct, strictly increasing created_at (not one frozen retro stamp)', () => {
    const sets = finalSession().exercises.flatMap(ex => ex.sets);
    expect(sets).toHaveLength(SETS);
    const stamps = sets.map(s => s.createdAt.getTime());
    expect(new Set(stamps).size).toBe(SETS);
    // Increasing in set order (live sets take the DB clock, so only order — not the scripted values — is provable).
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]!).toBeGreaterThan(stamps[i - 1]!);
    }
  });

  it('AC-RT-3: started_at is the first set (~T0+180m), not plan acceptance', () => {
    const startedAt = finalSession().startedAt!.getTime();
    expect(Math.abs(startedAt - (T0.getTime() + FIRST_SET_AT_MIN * MIN))).toBeLessThan(2 * MIN);
  });

  it('AC-RT-3: last_activity_at is the last set (~T0+255m)', () => {
    const lastActivityAt = finalSession().lastActivityAt.getTime();
    expect(Math.abs(lastActivityAt - (T0.getTime() + LAST_SET_AT_MIN * MIN))).toBeLessThan(2 * MIN);
  });

  it('AC-RT-3: completed_at is not before started_at and is at/after the last set', () => {
    const { startedAt, completedAt } = finalSession();
    expect(completedAt!.getTime()).toBeGreaterThanOrEqual(startedAt!.getTime());
    expect(completedAt!.getTime()).toBeGreaterThanOrEqual(T0.getTime() + LAST_SET_AT_MIN * MIN - MIN);
  });

  it('AC-RT-3: duration_minutes is 75 ± 1', () => {
    const duration = finalSession().durationMinutes;
    expect(duration).toBeGreaterThanOrEqual(74);
    expect(duration).toBeLessThanOrEqual(76);
  });

  it('AC-RT-4: no set confirmation the model saw says "retro-logged"', () => {
    const retroSteps = setStepIndexes.filter(i => (seenByStep.get(i) ?? '').includes('retro-logged'));
    expect(retroSteps).toEqual([]);
  });

  it('AC-RT-4: the STALE SESSION block is gone from the prompt of every run after the first live set', () => {
    const staleSteps = setStepIndexes.slice(1).filter(i => (seenByStep.get(i) ?? '').includes('=== STALE SESSION ==='));
    expect(staleSteps).toEqual([]);
  });

  it('consumed the whole script (no fallback answer leaked in)', () => {
    expect(model.chatScriptExhausted).toBe(true);
  });
});
