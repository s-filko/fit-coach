/**
 * REPRODUCTION (RED) — session-investigation-0925 plan, Task 1, F1 + F2 /
 * AC-SI-1c, AC-SI-2. Runs only through the DB test lock
 * (`db-test-lock.sh`); promoted into a `log-set` integration test + the
 * scenario suite when the fix lands.
 *
 * Over the REAL test DB (real `log_set` tool, real training tool policy —
 * `llmErrorBudget: 1`, tool-policy.ts:43/training.spec.ts:59 — real
 * `session_sets.rpe integer` column), two runs:
 *
 * - run N: the user reports a set with a fractional RPE ("9-10" → 9.5, the
 *   dev-session shape, F2). `log_set`'s Zod schema accepts 1–10 fractional
 *   values, but the DB column is `integer` — the INSERT throws, the tool
 *   catches it and returns an `llm_error`. The model (scripted, deterministic
 *   here) retries once with the same value — exactly like the real dev
 *   session (0c4ddb4b, dcccd492) — which is the run's SECOND llm_error and
 *   legitimately exhausts training's own budget of 1 (2 > 1) at run N itself.
 *   AC-SI-2 is the evidence from this run: on a fixed column/validation, the
 *   set would SAVE with its RPE — today it does not save at all.
 * - run N+1: a plain `log_set` with no RPE — this run's OWN batch has ZERO
 *   errors. AC-SI-1c: the "per run" contract (tool-policy.ts:43) says this
 *   run must not inherit run N's already-settled budget hit. Production
 *   counts `llm_error` ToolMessages over the WHOLE history (tool-executor.ts
 *   :207), so it wrongly re-exhausts here too and delivers the catalog
 *   fallback instead of the scripted reply, even though the tool succeeded.
 */
import type { WorkoutSet } from '../../../evals/schema/scenario.schema';
import type { Scenario } from '../../../evals/schema/scenario.schema';
import { BENCH_PRESS_ID, setupSteps, sharedPast } from '../../../evals/scenarios/b-full-workout.scenario';
import { runScenario, type ScenarioRunResult, type ScenarioStepObservation } from '../../../evals/lib/run-scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

const T0 = new Date('2026-09-25T09:00:00.000Z');

const RUN_N_TEXT = 'записал жим 80 на 8, рпе 9-10';
const RUN_N_PLUS_1_TEXT = 'ещё раз 80 на 8';
/** What the (scripted) model says after the clean log_set — run N+1's desired delivered text. */
export const RUN_N_PLUS_1_REPLY_TEXT = 'Записал, продолжай в том же духе.';

/**
 * The owner's real shape (F3 context): Telegram `language_code` is `en`, but
 * the owner writes Russian — kept here even though this file's assertions
 * are about the budget/RPE bugs, not the fallback language, so the DB
 * scenario matches the real dev session exactly (session-investigation-0925
 * Findings table, source session).
 */
const past: Scenario['past'] = { ...sharedPast, user: { ...sharedPast.user, languageCode: 'en' } };

const scenarioDef: Scenario = {
  id: 'set-error-recovery-repro',
  description:
    'reproduction: a fractional-RPE log_set fails against the real session_sets.rpe integer column (F2), ' +
    'and the training error budget (llmErrorBudget: 1, "per run") wrongly carries the resulting llm_error ' +
    'into the next run even though that run has none of its own (F1)',
  past,
  steps: [
    ...setupSteps,
    { action: 'advance', at: '+5m' },
    // --- run N: fractional RPE, retried once — DB rejects both, training's
    // OWN budget (2 errors > 1) legitimately ends this run. AC-SI-2 evidence. ---
    {
      action: 'user',
      text: RUN_N_TEXT,
      script: [
        { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 80, rpe: 9.5 } } },
        { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 80, rpe: 9.5 } } },
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

const RUN_N_INDEX = 4;
const RUN_N_PLUS_1_INDEX = 5;

async function runJourney(): Promise<{ result: ScenarioRunResult; model: ScriptedModelHandle }> {
  const model = installScriptedModel();
  for (const step of scenarioDef.steps) {
    if (step.action === 'user') {
      model.enqueueChat(step.script ?? []);
    }
  }
  const result = await runScenario(scenarioDef, { onAdvance: now => jest.setSystemTime(now) });
  return { result, model };
}

/** The `Barbell Bench Press` sets of the (single) `upper_a` session in one step's snapshot. */
function benchSetsOf(obs: ScenarioStepObservation): Array<{ setData: WorkoutSet; rpe: number | null }> {
  const session = obs.sessions.find(s => s.sessionKey === 'upper_a');
  if (!session) {
    throw new Error("set-error-recovery repro: no upper_a session in this step's snapshot");
  }
  const exercise = session.exercises.find(ex => ex.exercise.name === 'Barbell Bench Press');
  return (exercise?.sets ?? []) as unknown as Array<{ setData: WorkoutSet; rpe: number | null }>;
}

describe('set-error-recovery — reproduction (F1 + F2, AC-SI-1c, AC-SI-2)', () => {
  let result: ScenarioRunResult;

  beforeAll(async () => {
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);
    const run = await runJourney();
    result = run.result;
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('AC-SI-2 (F2): log_set with a fractional RPE over the real session_sets.rpe integer column', () => {
    it('saves the set with its RPE, instead of failing the INSERT and dropping it', () => {
      const sets = benchSetsOf(result.steps[RUN_N_INDEX]!);
      // Desired (fix-time): the set is saved and its rpe is not null. Today
      // the INSERT throws on both attempts — nothing is saved — so this
      // fails: sets is empty.
      expect(sets).toHaveLength(1);
      expect(sets[0]?.rpe).not.toBeNull();
    });
  });

  describe("AC-SI-1c (F1): a run with zero errors of its own must not inherit an earlier run's budget hit", () => {
    it('the delivered reply is the scripted model text, not the catalog "could not save" fallback', () => {
      const delivered = result.steps[RUN_N_PLUS_1_INDEX]!.delivered;
      // Desired: training's per-run contract (tool-policy.ts:43) means this
      // clean run answers normally. Today the executor counts run N's
      // (already-settled) errors against this run too and wrongly ends it
      // with the catalog message instead.
      expect(delivered).toContain(RUN_N_PLUS_1_REPLY_TEXT);
    });

    it('the clean log_set call still persisted (the tool wrote to the DB before the budget check ran)', () => {
      const sets = benchSetsOf(result.steps[RUN_N_PLUS_1_INDEX]!);
      const persistedThisRun = sets.some(s => (s.setData as { reps?: number }).reps === 8);
      expect(persistedThisRun).toBe(true);
    });
  });
});
