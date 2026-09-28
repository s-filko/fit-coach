/**
 * session-investigation-0925 plan, Remediation R1 (BUG-034, F1) — AC-SI-1c.
 * Home test at promotion (was tests/integration/scenarios/set-error-recovery.repro.test.ts).
 *
 * The training tool-error budget is "per run" (tool-policy.ts:43,
 * `llmErrorBudget: 1`): a run's own `llm_error`s are everything after the
 * last `HumanMessage` in `state.messages`. Over the REAL test DB (real
 * `log_set` tool, real training tool policy — training.spec.ts:59), two runs:
 *
 * - run N: the user reports a set for an exercise the server cannot resolve.
 *   The scripted model calls `log_set` twice with an unresolvable
 *   `exerciseId` (neither in the session/plan nor in the exercise catalog,
 *   `ensureCurrentExercise` in training.service.ts) — two genuine
 *   `llm_error`s, alone already over the budget of 1, so run N ends with the
 *   catalog fallback (the two calls carry different `order` values so
 *   tool-policy's `log_set` batch-dedup does not swallow them as duplicates
 *   first).
 * - run N+1: a plain, successful `log_set` for the real bench-press exercise
 *   — this run's OWN batch has ZERO errors. It must not inherit run N's
 *   already-settled budget hit and must deliver the scripted reply, not the
 *   catalog fallback.
 */
import { runScenario, type ScenarioRunResult, type ScenarioStepObservation } from '../../../evals/lib/run-scenario';
import { BENCH_PRESS_ID, setupSteps, sharedPast } from '../../../evals/scenarios/b-full-workout.scenario';
import type { Scenario, WorkoutSet } from '../../../evals/schema/scenario.schema';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel } from './scripted-model';

const T0 = new Date('2026-09-25T09:00:00.000Z');

/** A schema-valid v4 UUID that is neither in the session/plan nor in the test exercise catalog. */
const UNKNOWN_EXERCISE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const RUN_N_TEXT = 'записал 80 на 8 для непонятного упражнения';
const RUN_N_PLUS_1_TEXT = 'ещё раз 80 на 8';
/** What the (scripted) model says after the clean log_set — run N+1's desired delivered text. */
export const RUN_N_PLUS_1_REPLY_TEXT = 'Записал, продолжай в том же духе.';

/**
 * The owner's real shape (F3 context): Telegram `language_code` is `en`, but
 * the owner writes Russian — kept here even though this file's assertions
 * are about the per-run budget, not the fallback language, so the DB
 * scenario matches the real dev session exactly (session-investigation-0925
 * Findings table, source session).
 */
const past: Scenario['past'] = { ...sharedPast, user: { ...sharedPast.user, languageCode: 'en' } };

const scenarioDef: Scenario = {
  id: 'set-error-recovery',
  description:
    'the training error budget (llmErrorBudget: 1, "per run") must not carry an earlier run\'s ' +
    'llm_error into the next run when that run has none of its own (BUG-034, F1)',
  past,
  steps: [
    ...setupSteps,
    { action: 'advance', at: '+5m' },
    // --- run N: two genuine llm_errors (unresolvable exerciseId), alone over budget 1. ---
    {
      action: 'user',
      text: RUN_N_TEXT,
      script: [
        { toolCall: { name: 'log_set', args: { exerciseId: UNKNOWN_EXERCISE_ID, reps: 8, weight: 80, order: 1 } } },
        { toolCall: { name: 'log_set', args: { exerciseId: UNKNOWN_EXERCISE_ID, reps: 8, weight: 80, order: 2 } } },
      ],
    },
    // --- run N+1: a clean log_set, zero errors of its own. AC-SI-1c. ---
    {
      action: 'user',
      text: RUN_N_PLUS_1_TEXT,
      script: [
        { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 80 } } },
        { text: RUN_N_PLUS_1_REPLY_TEXT },
      ],
    },
  ],
};

const RUN_N_PLUS_1_INDEX = 5;

async function runJourney(): Promise<ScenarioRunResult> {
  const model = installScriptedModel();
  for (const step of scenarioDef.steps) {
    if (step.action === 'user') {
      model.enqueueChat(step.script ?? []);
    }
  }
  return runScenario(scenarioDef, { onAdvance: now => jest.setSystemTime(now) });
}

/** The `Barbell Bench Press` sets of the (single) `upper_a` session in one step's snapshot. */
function benchSetsOf(obs: ScenarioStepObservation): Array<{ setData: WorkoutSet; rpe: number | null }> {
  const session = obs.sessions.find(s => s.sessionKey === 'upper_a');
  if (!session) {
    throw new Error("set-error-recovery: no upper_a session in this step's snapshot");
  }
  const exercise = session.exercises.find(ex => ex.exercise.name === 'Barbell Bench Press');
  return (exercise?.sets ?? []) as unknown as Array<{ setData: WorkoutSet; rpe: number | null }>;
}

describe('set-error-recovery (BUG-034, AC-SI-1c)', () => {
  let result: ScenarioRunResult;

  beforeAll(async () => {
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);
    result = await runJourney();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe("AC-SI-1c: a run with zero errors of its own must not inherit an earlier run's budget hit", () => {
    it('the delivered reply is the scripted model text, not the catalog "could not save" fallback', () => {
      const { delivered } = result.steps[RUN_N_PLUS_1_INDEX]!;
      expect(delivered).toContain(RUN_N_PLUS_1_REPLY_TEXT);
    });

    it('the clean log_set call still persisted (the tool wrote to the DB before the budget check ran)', () => {
      const sets = benchSetsOf(result.steps[RUN_N_PLUS_1_INDEX]!);
      const persistedThisRun = sets.some(s => (s.setData as { reps?: number }).reps === 8);
      expect(persistedThisRun).toBe(true);
    });
  });
});
