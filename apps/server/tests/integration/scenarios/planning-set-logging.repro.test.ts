/**
 * REPRODUCTION (RED) — AC-CB-2 / BUG-022 (roadmap R0.1). Runs only via the repro glob; promoted to
 * a regular scenario test when U5 `transition-handoff` (R2.1) lands.
 *
 * In session_planning the user reports a set. Today the phase has no log_set tool, so the call is
 * rejected and nothing is stored. The script order may be changed by U5 (D-3); the
 * assertion on session_sets may not.
 */
import { eq } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { sessionExercises, sessionSets, workoutSessions } from '@infra/db/schema';

import { runScenario, type ScenarioRunResult } from '../../../evals/lib/run-scenario';
import { ScenarioSchema, type Scenario } from '../../../evals/schema/scenario.schema';
import { BENCH_PRESS_ID, sharedPast, setupSteps } from '../../../evals/scenarios/b-full-workout.scenario';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

/** The scenario's weekday labels in the imported setup steps are pinned to this T0. */
const T0 = new Date('2026-09-20T10:00:00.000Z');

/** jest's `FakeableAPI` minus 'Date' — the union itself is not exported by @types/jest. */
type RealTimerApi =
  | 'setTimeout'
  | 'clearTimeout'
  | 'setInterval'
  | 'clearInterval'
  | 'setImmediate'
  | 'clearImmediate'
  | 'nextTick'
  | 'queueMicrotask'
  | 'performance'
  | 'hrtime'
  | 'requestAnimationFrame'
  | 'cancelAnimationFrame'
  | 'requestIdleCallback'
  | 'cancelIdleCallback';

/** Timer APIs that must stay REAL — pg, PostgresSaver and the ONNX embedding
 * pipeline schedule work through them; only `Date` is faked. */
const REAL_TIMER_APIS: RealTimerApi[] = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'nextTick',
  'queueMicrotask',
  'performance',
  'hrtime',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
];

const SET_REPORT = 'второй подход повторил 110×12';

const planningSetScenario: Scenario = {
  id: 'r01-planning-set-logging',
  description: 'a set reported during session_planning is stored (BUG-022)',
  past: sharedPast,
  steps: [
    ...setupSteps.slice(0, 2), // chat → session_planning → proposal; training NOT started
    {
      action: 'user',
      text: SET_REPORT,
      script: [
        { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 12, weight: 110 } } },
        { text: 'Записал второй подход: 110 × 12.' },
      ],
      expect: {},
    },
  ],
};

describe('BUG-022 repro — a set reported during session_planning', () => {
  let result: ScenarioRunResult;
  let model: ScriptedModelHandle;

  beforeAll(async () => {
    expect(ScenarioSchema.parse(planningSetScenario)).toBeTruthy(); // the scenario is format-valid
    model = installScriptedModel();
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);
    for (const step of planningSetScenario.steps) {
      if (step.action === 'user') {
        model.enqueueChat(step.script ?? []);
      }
    }

    result = await runScenario(planningSetScenario, {
      onAdvance: now => jest.setSystemTime(now),
    });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('control: the setup reaches session_planning before the set is reported', () => {
    // index 1 = setupSteps[1], "давай верх" — the proposal step, run right
    // before the set-report step (index 2). Proves the red below fails for
    // the stated reason (no log_set tool in this phase), not a setup error.
    const [, proposalStep] = result.steps;
    expect(proposalStep?.action).toBe('user');
    expect(proposalStep?.phase).toBe('session_planning');
  });

  it('stores the set reported during planning', async () => {
    const sets = await db
      .select({ setData: sessionSets.setData })
      .from(sessionSets)
      .innerJoin(sessionExercises, eq(sessionSets.sessionExerciseId, sessionExercises.id))
      .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
      .where(eq(workoutSessions.userId, result.userId));

    expect(sets.map(s => s.setData)).toContainEqual(expect.objectContaining({ reps: 12, weight: 110 }));
  });
});
