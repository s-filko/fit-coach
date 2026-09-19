/**
 * L3 unit tests (training-journey-scenarios plan, Task 6 / AC-TJ-4): the live
 * layer's gating, ceiling, DB guard, clock and evaluation — proven with a
 * FAKE runner only. No model call, no DB: `runScenarioFn` is injected, so the
 * real `run-scenario.ts` (and the whole pg/di graph beneath it) is never
 * loaded, and every gate reads an injected `env`.
 */
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { buildReport, exitCodeFor, type CheckResult } from '../../lib/reporter';
import type { ScenarioRunResult, ScenarioStepObservation } from '../../lib/run-scenario';
import { assertionText, resolveRelativeTime, ScenarioSchema, type Scenario } from '../../schema/scenario.schema';

import { countUserSteps, evaluateScenario, loadScenarios, planL3Calls, runL3, type ScenarioRunner } from '../l3';

// --- fixtures ---

/** A minimal valid journey: two user steps around one +3.5 h advance. */
const tinyScenario: Scenario = ScenarioSchema.parse({
  id: 'l3-tiny',
  description: 'unit-test journey',
  past: {
    user: { languageCode: 'ru', timezone: 'Europe/Berlin' },
    workouts: [],
    facts: [],
  },
  steps: [
    {
      action: 'user',
      text: 'привет',
      script: [{ text: 'Привет!' }], // ignored by L3 — nothing consumes it
      expect: {
        seen: { mustMatch: ['RECENT TRAINING HISTORY'] }, // skipped by L3
        tools: { must: ['request_transition'] },
        delivered: { mustMatch: ['Привет'] },
        phaseAfter: { phase: 'session_planning' },
        persisted: { turnRecorded: true },
      },
    },
    { action: 'advance', at: '+3.5h' },
    {
      action: 'user',
      text: 'дальше',
      script: [{ text: 'ок' }],
      expect: {
        delivered: {
          mustMatch: [{ text: 'к предыдущей тренировке', liveOnly: true }],
          mustNotMatch: [{ text: 'не доехал', knownBug: 'BUG-9001/AC-X-9' }],
        },
        phaseAfter: { phase: 'training', knownBug: 'BUG-9001/AC-X-9' },
      },
    },
  ],
});

const runRowOf = (over: Partial<NonNullable<ScenarioStepObservation['runRow']>> = {}) => ({
  runId: 'run-1',
  phaseIn: 'chat',
  phaseOut: 'session_planning',
  outcome: 'ok',
  toolCalls: [{ name: 'request_transition', argsHash: 'h', outcomeKind: 'ok' }],
  transition: { toPhase: 'session_planning' },
  ...over,
});

const sessionWithSets = (
  over: Partial<{ status: string; durationMinutes: number | null; completedAt: Date | null }> = {},
) =>
  ({
    id: 's1',
    sessionKey: 'upper_a',
    status: 'in_progress',
    startedAt: new Date('2026-09-20T10:00:00Z'),
    completedAt: null,
    durationMinutes: null,
    lastActivityAt: new Date('2026-09-20T10:05:00Z'),
    createdAt: new Date('2026-09-20T10:00:00Z'),
    exercises: [
      {
        exercise: { name: 'Barbell Bench Press' },
        sets: [
          { setData: { type: 'strength', reps: 8, weight: 80 } },
          { setData: { type: 'strength', reps: 8, weight: 80 } },
        ],
      },
      { exercise: { name: 'Pull-ups' }, sets: [{ setData: { type: 'functional_reps', reps: 8 } }] },
    ],
    ...over,
  }) as unknown as WorkoutSessionWithDetails;

const obs = (
  stepIndex: number,
  action: 'advance' | 'user',
  over: Partial<ScenarioStepObservation> = {},
): ScenarioStepObservation => ({
  stepIndex,
  action,
  delivered: '',
  runRow: null,
  turnCount: 0,
  phase: 'chat',
  sessions: [],
  ...over,
});

const resultOf = (steps: ScenarioStepObservation[]): ScenarioRunResult => ({
  userId: 'u1',
  planId: null,
  t0: new Date(),
  steps,
});

/** A fake runner that replays fixed observations and records its calls. */
function fakeRunner(observations: ScenarioStepObservation[]): { runner: ScenarioRunner; calls: string[] } {
  const calls: string[] = [];
  const runner: ScenarioRunner = async scenario => {
    calls.push(scenario.id);
    // Same step count as the scenario; the observations were built to match.
    return resultOf(observations.slice(0, scenario.steps.length));
  };
  return { runner, calls };
}

// --- loadScenarios / call planning ---

describe('loadScenarios', () => {
  it('returns every authored journey by default', () => {
    expect(loadScenarios().map(s => s.id)).toEqual([
      'a-greeting-after-pause',
      'b-full-workout',
      'c-catch-up-logging',
      'c-catch-up-explicit',
    ]);
  });

  it('narrows to exactly one scenario by id', () => {
    expect(loadScenarios('c-catch-up-explicit').map(s => s.id)).toEqual(['c-catch-up-explicit']);
  });

  it('throws on an unknown id, listing the available ones', () => {
    expect(() => loadScenarios('nope')).toThrow(/Unknown scenario 'nope'.*a-greeting-after-pause/s);
  });
});

describe('call planning (§7a: user steps × samples)', () => {
  it('counts only user steps — advance steps make no model call', () => {
    expect(countUserSteps([tinyScenario])).toBe(2);
  });

  it('multiplies by samples through the shared L1 planCallCount', () => {
    expect(planL3Calls([tinyScenario], 3)).toBe(6);
  });

  it('covers the authored journeys with a realistic user-step count', () => {
    const all = loadScenarios();
    expect(all.reduce((n, s) => n + s.steps.filter(step => step.action === 'user').length, 0)).toBe(
      countUserSteps(all),
    );
    expect(countUserSteps(all)).toBeGreaterThanOrEqual(20);
  });
});

// --- gating ---

describe('runL3 gating', () => {
  const passingEnv = { RUN_LLM_EVALS: '1', DB_NAME: 'fitcoach_test' };

  it('prints "skipped" without RUN_LLM_EVALS and never reaches the runner', async () => {
    const { runner, calls } = fakeRunner([]);
    let planned = 0;
    const outcome = await runL3([tinyScenario], 1, {
      env: { DB_NAME: 'fitcoach_test' },
      runScenarioFn: runner,
      onPlanned: () => {
        planned += 1;
      },
    });
    expect(outcome.status).toBe('skipped');
    if (outcome.status === 'skipped') {
      expect(outcome.message).toContain('skipped');
    }
    expect(calls).toHaveLength(0);
    expect(planned).toBe(0);
  });

  it('refuses when DB_NAME does not end in _test, before any run', async () => {
    const { runner, calls } = fakeRunner([]);
    const outcome = await runL3([tinyScenario], 1, {
      env: { RUN_LLM_EVALS: '1', DB_NAME: 'fitcoach_dev' },
      runScenarioFn: runner,
    });
    expect(outcome.status).toBe('refused');
    if (outcome.status === 'refused') {
      expect(outcome.message).toContain('_test');
      expect(outcome.message).toContain('fitcoach_dev');
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses over the ceiling (shared L1 guard) and allows the EVALS_FULL_RUN red button', async () => {
    const { runner: r1, calls: c1 } = fakeRunner([]);
    const refused = await runL3([tinyScenario], 1, {
      env: { ...passingEnv, EVALS_CALL_CEILING: '1' }, // 2 planned > 1
      runScenarioFn: r1,
    });
    expect(refused.status).toBe('refused');
    if (refused.status === 'refused') {
      expect(refused.message).toContain('EVALS_CALL_CEILING');
    }
    expect(c1).toHaveLength(0);

    const { runner: r2 } = fakeRunner([obs(0, 'user'), obs(1, 'advance'), obs(2, 'user')]);
    const ran = await runL3([tinyScenario], 1, {
      env: { ...passingEnv, EVALS_CALL_CEILING: '1', EVALS_FULL_RUN: '1' },
      runScenarioFn: r2,
    });
    expect(ran.status).toBe('ran');
  });

  it('runs scenarios × samples, reports the plan first, and counts known bugs', async () => {
    const observations = [
      obs(0, 'user', {
        delivered: 'Привет! Поехали.',
        runRow: runRowOf(),
        turnCount: 1,
        phase: 'session_planning',
      }),
      obs(1, 'advance'),
      obs(2, 'user', { delivered: 'ок', runRow: runRowOf({ outcome: 'ok' }), turnCount: 1, phase: 'training' }),
    ];
    const { runner, calls } = fakeRunner(observations);
    const plans: number[] = [];
    const outcome = await runL3([tinyScenario, tinyScenario], 2, {
      env: passingEnv,
      runScenarioFn: runner,
      onPlanned: info => plans.push(info.plannedCalls),
    });
    expect(outcome.status).toBe('ran');
    if (outcome.status !== 'ran') {
      return;
    }
    // 2 scenarios × 2 samples, plan printed once before the first call.
    expect(calls).toEqual(['l3-tiny', 'l3-tiny', 'l3-tiny', 'l3-tiny']);
    expect(plans).toEqual([8]);
    // Sample labels disambiguate repeated runs of the same scenario.
    expect(outcome.results.some(r => r.case === 'l3-tiny[2]::step 0')).toBe(true);
    expect(outcome.knownBugs).toBeGreaterThan(0);
  });
});

// --- pure evaluation ---

describe('evaluateScenario', () => {
  const goodRun = (): ScenarioRunResult =>
    resultOf([
      obs(0, 'user', {
        delivered: 'Привет! Поехали.',
        runRow: runRowOf(),
        turnCount: 1,
        phase: 'session_planning',
        sessions: [sessionWithSets()],
      }),
      obs(1, 'advance'),
      obs(2, 'user', {
        delivered: 'Записал к предыдущей тренировке. Закрыть её?',
        runRow: runRowOf({ toolCalls: [{ name: 'log_set', argsHash: 'h', outcomeKind: 'ok' }] }),
        turnCount: 2,
        phase: 'training',
      }),
    ]);

  it('checks tools from the conversation_runs row', () => {
    const results = evaluateScenario(tinyScenario, goodRun());
    expect(results.find(r => r.check === 'tools.must:request_transition')?.passed).toBe(true);
  });

  it('fails a required tool that was not called', () => {
    const run = goodRun();
    run.steps[0]!.runRow!.toolCalls = [];
    const results = evaluateScenario(tinyScenario, run);
    const check = results.find(r => r.check === 'tools.must:request_transition');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('no tool calls');
  });

  it('evaluates delivered INCLUDING liveOnly entries — they exist for this layer', () => {
    const results = evaluateScenario(tinyScenario, goodRun());
    const live = results.find(r => r.check.startsWith('delivered.mustMatch:"к предыдущей тренировке"'));
    expect(live?.passed).toBe(true);
  });

  it('fails a liveOnly entry whose wording is absent', () => {
    const run = goodRun();
    run.steps[2]!.delivered = 'Готово.';
    const results = evaluateScenario(tinyScenario, run);
    expect(results.find(r => r.check.startsWith('delivered.mustMatch:"к предыдущей тренировке"'))?.passed).toBe(false);
  });

  it('ignores the seen plane entirely — only a scripted model can observe its input', () => {
    const results = evaluateScenario(tinyScenario, goodRun());
    expect(results.some(r => r.check.startsWith('seen'))).toBe(false);
  });

  it('emits a run.outcome check per user step', () => {
    const run = goodRun();
    run.steps[2]!.runRow!.outcome = 'error';
    const results = evaluateScenario(tinyScenario, run);
    expect(results.find(r => r.case.endsWith('step 0') && r.check === 'run.outcome')?.passed).toBe(true);
    expect(results.find(r => r.case.endsWith('step 2') && r.check === 'run.outcome')?.passed).toBe(false);
  });

  it('labels knownBug assertions without counting them as regressions', () => {
    // Step 2's phaseAfter is knownBug-tagged and deliberately wrong here
    // (the observation says training, the expectation says training — flip
    // the observation to make the assertion fail).
    const run = goodRun();
    run.steps[2]!.phase = 'chat';
    const results = evaluateScenario(tinyScenario, run);
    const tagged = results.find(r => r.check === 'phaseAfter' && r.case.endsWith('step 2'));
    expect(tagged?.passed).toBe(false);
    expect(tagged?.knownBug).toBe('BUG-9001/AC-X-9');
    const report = buildReport(
      'L3',
      results.filter(r => r.check === 'phaseAfter'),
    );
    expect(report.failed).toBe(0);
    expect(report.known).toBe(1);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('tags a failing per-entry knownBug assertion (entry carries the tag)', () => {
    const run = goodRun();
    run.steps[2]!.delivered = 'не доехал до зала'; // hits the mustNotMatch entry
    const results = evaluateScenario(tinyScenario, run);
    const entry = results.find(r => r.check.startsWith('delivered.mustNotMatch:"не доехал"'));
    expect(entry?.passed).toBe(false);
    expect(entry?.knownBug).toBe('BUG-9001/AC-X-9');
  });

  it('checks persisted.turnRecorded through the observation turnCount', () => {
    const run = goodRun();
    run.steps[0]!.turnCount = 0;
    const results = evaluateScenario(tinyScenario, run);
    expect(results.find(r => r.check === 'persisted.turnRecorded')?.passed).toBe(false);
  });

  it('checks phaseAfter with expected/got detail', () => {
    const run = goodRun();
    run.steps[0]!.phase = 'chat';
    const results = evaluateScenario(tinyScenario, run);
    const check = results.find(r => r.case.endsWith('step 0') && r.check === 'phaseAfter');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('session_planning');
  });

  it('flags a missing observation for a step', () => {
    const results = evaluateScenario(tinyScenario, resultOf([obs(0, 'user')]));
    expect(results.find(r => r.check === 'observed' && r.case.endsWith('step 1'))?.passed).toBe(false);
  });

  describe('persisted.session (the projection the deterministic layer asserts)', () => {
    const persistedScenario: Scenario = {
      ...tinyScenario,
      steps: [
        {
          action: 'user',
          text: 'сделал жим',
          expect: {
            persisted: {
              session: {
                key: 'upper_a',
                status: 'in_progress',
                hasStartedAt: true,
                hasCompletedAt: false,
                durationMinutes: null,
                exercises: [
                  {
                    exercise: 'Barbell Bench Press',
                    sets: [
                      { reps: 8, weight: 80 },
                      { reps: 8, weight: 80 },
                    ],
                  },
                  { exercise: 'Pull-ups', sets: [{ reps: 8 }] },
                ],
              },
            },
          },
        },
      ],
    };

    it('passes on an exact projection match (order, weights, bodyweight without weight)', () => {
      const results = evaluateScenario(
        persistedScenario,
        resultOf([obs(0, 'user', { runRow: runRowOf(), turnCount: 1, sessions: [sessionWithSets()] })]),
      );
      const failed = results.filter(r => !r.passed);
      expect(failed).toEqual([]);
      expect(results.find(r => r.check === 'persisted.session.exercises')?.passed).toBe(true);
    });

    it('fails on a wrong durationMinutes with expected/got detail', () => {
      const results = evaluateScenario(
        persistedScenario,
        resultOf([
          obs(0, 'user', { runRow: runRowOf(), turnCount: 1, sessions: [sessionWithSets({ durationMinutes: 11 })] }),
        ]),
      );
      const check = results.find(r => r.check === 'persisted.session.durationMinutes');
      expect(check?.passed).toBe(false);
      expect(check?.detail).toContain('11');
    });

    it('fails when the persisted set order or weight drifts', () => {
      const drifted = sessionWithSets();
      const driftedSets = drifted.exercises[0]!.sets as unknown as Array<{
        setData: { type: string; reps: number; weight?: number };
      }>;
      driftedSets[1]!.setData = { type: 'strength', reps: 8, weight: 85 };
      const results = evaluateScenario(
        persistedScenario,
        resultOf([obs(0, 'user', { runRow: runRowOf(), turnCount: 1, sessions: [drifted] })]),
      );
      expect(results.find(r => r.check === 'persisted.session.exercises')?.passed).toBe(false);
    });

    it('fails when no matching session exists in the snapshot', () => {
      const results = evaluateScenario(persistedScenario, resultOf([obs(0, 'user', { runRow: runRowOf() })]));
      const check = results.find(r => r.check === 'persisted.session');
      expect(check?.passed).toBe(false);
      expect(check?.detail).toContain('no upper_a session');
    });
  });
});

// --- the live clock (coordinator ruling 2026-09-20): advance steps jump Date ---

describe('runL3 clock', () => {
  it('advances a Date-only fake clock on advance steps, keeps timers real, and restores Date after', async () => {
    const RealDate = Date;
    const realSetTimeout = globalThis.setTimeout;

    const dates: number[] = [];
    let setTimeoutUntouched = true;
    const runner: ScenarioRunner = async (scenario, opts) => {
      const t0 = new Date();
      const steps: ScenarioStepObservation[] = [];
      for (const [stepIndex, step] of scenario.steps.entries()) {
        // Recorded at step ENTRY, before any clock jump this step performs.
        dates.push(Date.now());
        if (step.action === 'advance') {
          opts.onAdvance?.(resolveRelativeTime(step.at, t0));
        }
        if (globalThis.setTimeout !== realSetTimeout) {
          setTimeoutUntouched = false;
        }
        steps.push(obs(stepIndex, step.action));
      }
      return resultOf(steps);
    };

    const outcome = await runL3([tinyScenario], 1, {
      env: { RUN_LLM_EVALS: '1', DB_NAME: 'fitcoach_test' },
      runScenarioFn: runner,
    });
    expect(outcome.status).toBe('ran');

    // Three steps; the +3.5 h advance sits between step 0 and step 2.
    expect(dates).toHaveLength(3);
    expect(Math.abs(dates[1]! - dates[0]!)).toBeLessThan(5_000);
    const jump = dates[2]! - dates[1]!;
    expect(jump).toBeGreaterThanOrEqual(3.5 * 3_600_000 - 10_000);
    expect(jump).toBeLessThanOrEqual(3.5 * 3_600_000 + 10_000);

    // Timer APIs were never faked (HTTP/provider timeouts stay real)…
    expect(setTimeoutUntouched).toBe(true);
    // …and the clock is uninstalled once the run is over.
    expect(Date).toBe(RealDate);
  });
});
