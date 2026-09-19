/**
 * L3 — the live scenario level (training-journey-scenarios plan, Task 6 /
 * AC-TJ-4; PROMPT_EVAL_FRAMEWORK §2 "L3 scenario", §7a cost gate).
 *
 * The SAME scenario modules the deterministic layer runs
 * (evals/scenarios/*.scenario.ts) through the SAME runner
 * (evals/lib/run-scenario.ts) over the real test database — but with the
 * REAL model: no scripted `@infra/ai/model.factory` mock is installed, so
 * the journey's user turns go to the provider and back. What that proves is
 * the part a script can never prove: the model ITSELF chooses the right
 * action at every turn — the persisted plane (tools from `conversation_runs`,
 * DB session snapshot, phase) is the evidence.
 *
 * Differences from the deterministic layer, by design:
 * - `script` is ignored (nothing is enqueued anywhere);
 * - `seen` is skipped (only a scripted model can observe its own input);
 * - `delivered` is evaluated INCLUDING `liveOnly` entries — those exist for
 *   exactly this layer (e.g. journey C's catch-up reply wording);
 * - every assertion tagged `knownBug` is reported as a "known bug"
 *   reproduction, never counted as a regression (reporter.ts).
 *
 * Clock (coordinator ruling, 2026-09-20): a Date-only fake clock
 * (`@sinonjs/fake-timers`, `toFake: ['Date']`, `shouldAdvanceTime: true`,
 * starting at real now) makes `advance` steps work live exactly like the
 * deterministic layer's `jest.setSystemTime` — the DB write path was proven
 * compatible with a faked Date by the Task 2 spike, and the remote model
 * never sees our local clock. Timer APIs stay REAL: HTTP and the provider's
 * timeouts must not be faked. The clock is uninstalled in `finally`.
 *
 * Gating (owner rules, §7a): refuses without `RUN_LLM_EVALS=1` (prints
 * "skipped"), enforces the shared L1 call ceiling via `planCallCount`/
 * `guardDecision` over user steps × samples, and refuses unless `DB_NAME`
 * ends in `_test` (scenario-db-guard). NEVER run by a plan task — the owner
 * launches it manually (see evals/datasets/README.md § L3).
 */
import { install as installFakeClock } from '@sinonjs/fake-timers';

import { assertScenarioTestDatabase, isScenarioTestDatabase } from '../lib/scenario-db-guard';
import { guardDecision, planCallCount } from '../lib/run-guard';
import type { CheckResult } from '../lib/reporter';
import type { RunScenarioOptions, ScenarioRunResult, ScenarioStepObservation } from '../lib/run-scenario';
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import { assertionKnownBug, assertionText, type Scenario } from '../schema/scenario.schema';

import { scenario as journeyA } from '../scenarios/a-greeting-after-pause.scenario';
import { scenario as journeyB } from '../scenarios/b-full-workout.scenario';
import { explicitScenario as journeyCExplicit, scenario as journeyC } from '../scenarios/c-catch-up-logging.scenario';

/** Every authored journey, in run order. */
const ALL_SCENARIOS: Scenario[] = [journeyA, journeyB, journeyC, journeyCExplicit];

/** Loads the authored journeys; an id narrows to exactly that one. */
export function loadScenarios(scenarioId?: string): Scenario[] {
  if (scenarioId === undefined || scenarioId === '') {
    return ALL_SCENARIOS;
  }
  const found = ALL_SCENARIOS.filter(s => s.id === scenarioId);
  if (found.length === 0) {
    throw new Error(`Unknown scenario '${scenarioId}'. Available: ${ALL_SCENARIOS.map(s => s.id).join(', ')}`);
  }
  return found;
}

/** Only user steps reach a model — `advance` steps move the clock, nothing else. */
export function countUserSteps(scenarios: Scenario[]): number {
  return scenarios.reduce((n, s) => n + s.steps.filter(step => step.action === 'user').length, 0);
}

/** Model calls a live run will make (§7a's planCallCount over user steps × samples). */
export function planL3Calls(scenarios: Scenario[], samples: number): number {
  return planCallCount(countUserSteps(scenarios), samples);
}

// --- pure evaluation: one CheckResult per step per assertion ---

/** The `seen` plane is skipped live (only a scripted model can observe input). */

/** The persisted-session projection the schema's `expect.persisted.session` describes. */
function sessionProjection(session: WorkoutSessionWithDetails): {
  status: string;
  hasStartedAt: boolean;
  hasCompletedAt: boolean;
  durationMinutes: number | null;
  exercises: Array<{ exercise: string; sets: Array<Record<string, number>> }>;
} {
  return {
    status: session.status,
    hasStartedAt: session.startedAt != null,
    hasCompletedAt: session.completedAt != null,
    durationMinutes: session.durationMinutes ?? null,
    exercises: session.exercises.map(ex => ({
      exercise: ex.exercise.name,
      sets: ex.sets.map(s => ({
        ...(JSON.parse(JSON.stringify({ reps: (s.setData as { reps?: number }).reps })) as Record<string, number>),
        ...(s.setData.type === 'strength'
          ? (JSON.parse(JSON.stringify({ weight: (s.setData as { weight?: number }).weight })) as Record<string, number>)
          : {}),
      })),
    })),
  };
}

/** Drops undefined keys so expected and observed lists stringify comparably. */
function normalizeExpectedExercises(
  exercises: Array<{ exercise: string; sets: Array<{ reps?: number; weight?: number; rpe?: number }> }>,
): Array<{ exercise: string; sets: Array<Record<string, number>> }> {
  return exercises.map(ex => ({
    exercise: ex.exercise,
    sets: ex.sets.map(s => JSON.parse(JSON.stringify({ reps: s.reps, weight: s.weight, rpe: s.rpe })) as Record<
      string,
      number
    >),
  }));
}

function evaluateStep(
  caseId: string,
  step: Scenario['steps'][number],
  obs: ScenarioStepObservation,
  out: CheckResult[],
): void {
  const expect = step.expect ?? {};
  const add = (check: string, passed: boolean, knownBug: string | undefined, detail?: string): void => {
    out.push({ case: caseId, check, passed, ...(knownBug ? { knownBug } : {}), ...(detail ? { detail } : {}) });
  };

  // A user step must have produced a successful run row at all.
  if (step.action === 'user') {
    add('run.outcome', obs.runRow !== null && obs.runRow.outcome === 'ok', undefined,
      obs.runRow ? `outcome ${obs.runRow.outcome}` : 'no conversation_runs row');
  }

  // tools — from the conversation_runs row (the deterministic layer's recorder
  // is not installed live).
  const called = obs.runRow?.toolCalls?.map(c => c.name) ?? [];
  if (expect.tools) {
    for (const entry of expect.tools.must ?? []) {
      add(`tools.must:${assertionText(entry)}`, called.includes(assertionText(entry)),
        assertionKnownBug(entry) ?? expect.tools?.knownBug,
        called.length > 0 ? `called: ${called.join(', ')}` : 'no tool calls');
    }
    for (const entry of expect.tools.mustNot ?? []) {
      add(`tools.mustNot:${assertionText(entry)}`, !called.includes(assertionText(entry)),
        assertionKnownBug(entry) ?? expect.tools?.knownBug,
        called.includes(assertionText(entry)) ? `${assertionText(entry)} was called` : undefined);
    }
  }

  // delivered — including liveOnly entries (they exist for this layer).
  if (expect.delivered) {
    for (const entry of expect.delivered.mustMatch ?? []) {
      add(`delivered.mustMatch:"${assertionText(entry)}"`, obs.delivered.includes(assertionText(entry)),
        assertionKnownBug(entry) ?? expect.delivered?.knownBug,
        obs.delivered.length > 0 ? undefined : 'no delivered text');
    }
    for (const entry of expect.delivered.mustNotMatch ?? []) {
      add(`delivered.mustNotMatch:"${assertionText(entry)}"`, !obs.delivered.includes(assertionText(entry)),
        assertionKnownBug(entry) ?? expect.delivered?.knownBug,
        obs.delivered.includes(assertionText(entry)) ? `delivered text contains "${assertionText(entry)}"` : undefined);
    }
  }

  if (expect.phaseAfter) {
    add('phaseAfter', obs.phase === expect.phaseAfter.phase, expect.phaseAfter.knownBug,
      `expected ${expect.phaseAfter.phase}, got ${obs.phase}`);
  }

  // persisted — the plane that proves the model chose the right action.
  if (expect.persisted) {
    if (expect.persisted.turnRecorded === true) {
      add('persisted.turnRecorded', obs.turnCount > 0, expect.persisted.knownBug,
        obs.turnCount > 0 ? undefined : `turnCount ${obs.turnCount}`);
    }
    const expected = expect.persisted.session;
    if (expected) {
      const session = expected.key !== undefined
        ? obs.sessions.find(s => s.sessionKey === expected.key)
        : obs.sessions[0];
      if (!session) {
        add('persisted.session', false, expect.persisted.knownBug,
          `no ${expected.key ?? 'newest'} session in the step's DB snapshot`);
      } else {
        const projection = sessionProjection(session);
        if (expected.status !== undefined) {
          add('persisted.session.status', projection.status === expected.status,
            expect.persisted.knownBug, `expected ${expected.status}, got ${projection.status}`);
        }
        if (expected.hasStartedAt !== undefined) {
          add('persisted.session.hasStartedAt', projection.hasStartedAt === expected.hasStartedAt,
            expect.persisted.knownBug, `startedAt ${projection.hasStartedAt ? 'present' : 'absent'}`);
        }
        if (expected.hasCompletedAt !== undefined) {
          add('persisted.session.hasCompletedAt', projection.hasCompletedAt === expected.hasCompletedAt,
            expect.persisted.knownBug, `completedAt ${projection.hasCompletedAt ? 'present' : 'absent'}`);
        }
        if (expected.durationMinutes !== undefined) {
          add('persisted.session.durationMinutes', projection.durationMinutes === expected.durationMinutes,
            expect.persisted.knownBug, `expected ${expected.durationMinutes}, got ${projection.durationMinutes}`);
        }
        if (expected.exercises !== undefined) {
          const wanted = normalizeExpectedExercises(expected.exercises);
          add('persisted.session.exercises',
            JSON.stringify(projection.exercises) === JSON.stringify(wanted),
            expect.persisted.knownBug,
            `expected ${JSON.stringify(wanted)}, got ${JSON.stringify(projection.exercises)}`);
        }
      }
    }
  }
}

/** Evaluates every step of one run against its expectations (pure). */
export function evaluateScenario(scenario: Scenario, result: ScenarioRunResult, sampleLabel = ''): CheckResult[] {
  const out: CheckResult[] = [];
  scenario.steps.forEach((step, stepIndex) => {
    const obs = result.steps[stepIndex];
    if (!obs) {
      out.push({ case: `${scenario.id}${sampleLabel}::step ${stepIndex}`, check: 'observed', passed: false,
        detail: 'no observation for this step' });
      return;
    }
    evaluateStep(`${scenario.id}${sampleLabel}::step ${stepIndex}`, step, obs, out);
  });
  return out;
}

// --- the gated run ---

export type ScenarioRunner = (scenario: Scenario, opts: RunScenarioOptions) => Promise<ScenarioRunResult>;

export interface L3Deps {
  /** Environment the gates read; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** The scenario runner; defaults to the real DB-backed one (lazy import). */
  runScenarioFn?: ScenarioRunner;
  /** Fired once all gates pass, right before the first model call. */
  onPlanned?: (info: { plannedCalls: number; userSteps: number; samples: number; ceiling: number }) => void;
}

export type L3Outcome =
  | { status: 'skipped'; message: string }
  | { status: 'refused'; message: string }
  | { status: 'ran'; results: CheckResult[]; plannedCalls: number; knownBugs: number };

/**
 * Runs the journeys live: gates (flag → `_test` DB → call ceiling), installs
 * the Date-only fake clock, drives each scenario through the runner with the
 * clock wired to `onAdvance`, evaluates every step, uninstalls the clock.
 */
export async function runL3(scenarios: Scenario[], samples = 1, deps: L3Deps = {}): Promise<L3Outcome> {
  const env = deps.env ?? process.env;
  if (env['RUN_LLM_EVALS'] !== '1') {
    return { status: 'skipped', message: 'L3 skipped: set RUN_LLM_EVALS=1 to run scenario evals against a real model.' };
  }

  // Test-DB safety first: the runner seeds and mutates real rows.
  if (!isScenarioTestDatabase(env['DB_NAME'])) {
    let message: string;
    try {
      assertScenarioTestDatabase(env['DB_NAME']);
      message = 'L3 refused: DB_NAME does not end in _test';
    } catch (err) {
      message = `L3 refused: ${err instanceof Error ? err.message : String(err)}`;
    }
    return { status: 'refused', message };
  }

  // The shared L1 call ceiling (§7a) — one guard, not a second one.
  const userSteps = countUserSteps(scenarios);
  const plannedCalls = planCallCount(userSteps, samples);
  const ceiling = Number(env['EVALS_CALL_CEILING'] ?? 30);
  const guard = guardDecision(plannedCalls, { ceiling, fullRun: env['EVALS_FULL_RUN'] === '1' });
  if (!guard.ok) {
    return { status: 'refused', message: `L3 ${guard.message ?? 'refused by the call guard'}` };
  }
  deps.onPlanned?.({ plannedCalls, userSteps, samples, ceiling });

  const run = deps.runScenarioFn ?? (await import('../lib/run-scenario')).runScenario;

  // Date-only fake clock: advance steps jump it via onAdvance, exactly like
  // the deterministic layer's jest.setSystemTime; timers stay real.
  const clock = installFakeClock({ now: new Date(), toFake: ['Date'], shouldAdvanceTime: true });
  const results: CheckResult[] = [];
  try {
    for (const scenario of scenarios) {
      for (let sample = 0; sample < samples; sample += 1) {
        const result = await run(scenario, { onAdvance: now => clock.setSystemTime(now) });
        results.push(...evaluateScenario(scenario, result, samples > 1 ? `[${sample + 1}]` : ''));
      }
    }
  } finally {
    clock.uninstall();
  }
  return { status: 'ran', results, plannedCalls, knownBugs: results.filter(r => r.knownBug !== undefined).length };
}
