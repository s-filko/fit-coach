/**
 * retro-timestamps plan, T2 (BUG-043) — AC-RT-3 and AC-RT-4 over the real test DB.
 *
 *
 * The 2026-09-29 shape: the session is created and started at plan acceptance, the user reaches the
 * gym 3 h later, logs 16 sets over 75 minutes, then finishes. Scripted clock (Date-only fake timers).
 * Harness note: `run-scenario.ts` stamps a new session's `last_activity_at` with the scenario clock at
 * the first `advance` step, and live sets get their `created_at` from the DB clock (real time), so set
 * `created_at` is asserted for distinctness only, not against the scripted clock.
 */
import type { BaseMessage } from '@langchain/core/messages';

import { runScenario, type ScenarioRunResult, type ScenarioStepObservation } from '../../../evals/lib/run-scenario';
import { BENCH_PRESS_ID, setupSteps, sharedPast } from '../../../evals/scenarios/b-full-workout.scenario';
import type { Scenario } from '../../../evals/schema/scenario.schema';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel } from './scripted-model';

const T0 = new Date('2026-09-25T09:00:00.000Z');
const MIN = 60_000;
const SETS = 16;
const FIRST_SET_AT_MIN = 180;
const SET_GAP_MIN = 5;
const LAST_SET_AT_MIN = FIRST_SET_AT_MIN + (SETS - 1) * SET_GAP_MIN; // 255
const FINISH_TEXT = 'всё, закончил';
const FINISH_REPLY = 'Отличная работа!';

const steps: Scenario['steps'] = [...setupSteps, { action: 'advance', at: '+5m' }];
const setStepIndexes: number[] = [];
for (let i = 0; i < SETS; i++) {
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
  description: 'BUG-043: plan accepted, gym 3 h later, 16 live sets over 75 min, finish — timestamps must be live',
  past: sharedPast,
  steps,
};

function textOf(m: BaseMessage): string {
  return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
}

describe('retro-timestamps scenario (BUG-043, AC-RT-3, AC-RT-4)', () => {
  let result: ScenarioRunResult;
  const seenByStep = new Map<number, string>();

  beforeAll(async () => {
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);
    const model = installScriptedModel();
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
  });

  /** The workout session of this journey (newest first in every snapshot). */
  const finalSession = () => result.steps[FINISH_STEP_INDEX]!.sessions[0]!;

  it('the journey ran to the end (finish_training recorded)', () => {
    expect(result.steps[FINISH_STEP_INDEX]!.runRow?.toolCalls?.map(c => c.name)).toContain('finish_training');
    expect(finalSession().status).toBe('completed');
  });

  it('AC-RT-3: all 16 sets are saved with distinct created_at (not one frozen retro stamp)', () => {
    const sets = finalSession().exercises.flatMap(ex => ex.sets);
    expect(sets).toHaveLength(SETS);
    expect(new Set(sets.map(s => s.createdAt.getTime())).size).toBe(SETS);
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
});
