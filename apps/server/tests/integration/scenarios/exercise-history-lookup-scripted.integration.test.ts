/**
 * `get_exercise_history` (training-history-lookup plan, Task 1 — AC-HL-3): a scripted-model
 * training scenario. The user asks about an exercise EXERCISE HISTORY and RECENT WORKOUTS do NOT
 * cover (Running: not in the upper_a plan, and its one completed performance is 10 days back,
 * outside the 7-day RECENT WORKOUTS window) — the scripted model calls `get_exercise_history`, and
 * its dated result must reach the model on the SAME turn (the second scripted-model call, once the
 * tool has run — `scripted-model.ts`'s FIFO chat recording captures both calls of a turn).
 *
 * Real production wiring (`runScenario`) over the real test DB, reusing journey B's setup
 * (`setupSteps`/`sharedPast` — greeting → session_planning → proposal → start_training_session)
 * so this only adds one extra past workout and one extra turn.
 */
import { runScenario, type ScenarioRunResult, type ScenarioStepObservation } from '../../../evals/lib/run-scenario';
import type { Scenario } from '../../../evals/schema/scenario.schema';
import { setupSteps, sharedPast } from '../../../evals/scenarios/b-full-workout.scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

/** Same T0 journey B pins (Sunday, Europe/Berlin) — `-10d` lands on 2026-09-10. */
const T0 = new Date('2026-09-20T10:00:00.000Z');

const ASK_TEXT = 'а когда я в последний раз бегал?';
const HISTORY_REPLY_TEXT = 'По записям — давно, вот что есть.';

/** setupSteps (3 user steps) + one advance + this scenario's own ask step. */
const ASK_STEP_INDEX = 4;

const past: Scenario['past'] = {
  ...sharedPast,
  workouts: [
    ...sharedPast.workouts,
    // Outside the 7-day RECENT WORKOUTS window (T0 - 10d), and Running is not in the upper_a
    // plan — EXERCISE HISTORY never lists it either. The only way to see this data is the tool.
    {
      at: '-10d',
      key: 'cardio_a',
      exercises: [{ exercise: 'Running', sets: [{ distanceMeters: 5000, durationSeconds: 1800 }] }],
    },
  ],
};

const scenarioDef: Scenario = {
  id: 'exercise-history-lookup',
  description:
    'AC-HL-3: the user asks about an exercise absent from EXERCISE HISTORY/RECENT WORKOUTS; the ' +
    'model calls get_exercise_history and the dated numbers reach it on the same turn',
  past,
  steps: [
    ...setupSteps,
    { action: 'advance', at: '+5m' },
    {
      action: 'user',
      text: ASK_TEXT,
      script: [
        { toolCall: { name: 'get_exercise_history', args: { exerciseName: 'Running' } } },
        { text: HISTORY_REPLY_TEXT },
      ],
    },
  ],
};

function textOf(m: { content?: unknown } | undefined): string {
  const content = m?.content;
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
}

describe('get_exercise_history — scripted training scenario (AC-HL-3)', () => {
  let model: ScriptedModelHandle;
  let result: ScenarioRunResult;
  const seenByStep = new Map<number, string>();

  beforeAll(async () => {
    model = installScriptedModel();
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);
    for (const step of scenarioDef.steps) {
      if (step.action === 'user') {
        model.enqueueChat(step.script ?? []);
      }
    }

    result = await runScenario(scenarioDef, {
      onAdvance: now => jest.setSystemTime(now),
      onStep: obs => {
        if (obs.action !== 'user') {
          return;
        }
        const calls = model.drainChatInputs();
        seenByStep.set(
          obs.stepIndex,
          calls
            .flat()
            .map(textOf)
            .join('\n'),
        );
      },
    });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('the model called get_exercise_history', () => {
    const obs = result.steps[ASK_STEP_INDEX] as ScenarioStepObservation;
    const toolNames = obs.runRow?.toolCalls?.map(c => c.name) ?? [];
    expect(toolNames).toContain('get_exercise_history');
  });

  it("the tool result — dated, carrying Running's real numbers — reaches the model on the same turn", () => {
    const seen = seenByStep.get(ASK_STEP_INDEX) ?? '';
    expect(seen).toContain('2026-09-10');
    expect(seen).toContain('30min');
    expect(seen).not.toContain('no completed record of Running');
  });

  it('delivers the scripted reply built on that result', () => {
    const { delivered } = result.steps[ASK_STEP_INDEX]!;
    expect(delivered).toContain(HISTORY_REPLY_TEXT);
  });
});
