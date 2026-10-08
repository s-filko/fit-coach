/**
 * The n-load-* journeys, deterministic layer (coach-quality-proof T2 /
 * AC-CQ-2): six seeded history patterns over the real test database, each run
 * once with the scripted model — greeting → session_planning → start → the
 * «какой вес на …?» ask → a reported set. The expected load of every case is
 * COMPUTED by the weight oracle (evals/lib/weight-oracle.ts) from the seeded
 * history; the scripted reply and the logged set are built from that verdict,
 * so the whole journey is generated from the computation, never hand-typed.
 *
 * What this layer pins: the training request's `# History` rows (dates, sets,
 * loads used — the dated facts a live coach needs to name the same load) and
 * the persisted set at the expected weight. Whether a REAL model reads those
 * rows and proposes the oracle's load is T3's live measurement against
 * `nLoadExpectations()`.
 */
import type { BaseMessage } from '@langchain/core/messages';

import { runScenario, type ScenarioRunResult, type ScenarioStepObservation } from '../../../evals/lib/run-scenario';
import {
  assertionText,
  ScenarioSchema,
  type Scenario,
  type ScenarioStep,
} from '../../../evals/schema/scenario.schema';
import { N_LOAD_CASES, nLoadExpectations, verdictOf } from '../../../evals/scenarios/n-load-shared';
import { scenario as journeyUp } from '../../../evals/scenarios/n-load-up.scenario';
import { scenario as journeyMiss } from '../../../evals/scenarios/n-load-miss.scenario';
import { scenario as journeyEarlyStop } from '../../../evals/scenarios/n-load-early-stop.scenario';
import { scenario as journeyBreak } from '../../../evals/scenarios/n-load-break.scenario';
import { scenario as journeyUneven } from '../../../evals/scenarios/n-load-uneven.scenario';
import { scenario as journeyAsk } from '../../../evals/scenarios/n-load-ask.scenario';
import { scenario as journeyGravitron } from '../../../evals/scenarios/n-load-gravitron.scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

/** The journeys' pinned date labels and weekday names resolve against this T0 (a Sunday in Europe/Berlin). */
const T0 = new Date('2026-09-20T10:00:00.000Z');

const JOURNEYS: Scenario[] = [journeyUp, journeyMiss, journeyEarlyStop, journeyBreak, journeyUneven, journeyAsk, journeyGravitron];

const textOf = (m: BaseMessage | undefined): string => {
  const content = m?.content;
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
};

interface JourneyRun {
  result: ScenarioRunResult;
  /** Flattened model-input text per step (advance steps included, empty). */
  seenByStep: Map<number, string>;
  /** True when a scripted chat answer was never consumed (the script ran dry or overshot). */
  scriptLeftover: boolean;
}

let model: ScriptedModelHandle;
const runs = new Map<string, JourneyRun>();
const runOf = (scenario: Scenario): JourneyRun => runs.get(scenario.id)!;

async function runJourney(scenario: Scenario): Promise<JourneyRun> {
  model.reset();
  jest.setSystemTime(T0);
  const userSteps = scenario.steps.filter((s): s is Extract<ScenarioStep, { action: 'user' }> => s.action === 'user');
  for (const step of userSteps) {
    model.enqueueChat(step.script ?? []);
  }
  const seenByStep = new Map<number, string>();
  const result = await runScenario(scenario, {
    onAdvance: now => jest.setSystemTime(now),
    onStep: obs => {
      if (obs.action !== 'user') {
        return;
      }
      const calls = model.drainChatInputs();
      seenByStep.set(obs.stepIndex, calls.flat().map(m => textOf(m)).join('\n'));
    },
  });
  // After the whole journey: everything queued must have been consumed.
  const scriptLeftover = !model.chatScriptExhausted;
  return { result, seenByStep, scriptLeftover };
}

beforeAll(async () => {
  for (const scenario of JOURNEYS) {
    expect(ScenarioSchema.parse(scenario)).toBeTruthy(); // every journey is format-valid
  }
  model = installScriptedModel();
  jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
  jest.setSystemTime(T0);
  for (const scenario of JOURNEYS) {
    runs.set(scenario.id, await runJourney(scenario));
  }
}, 600_000);

afterAll(() => {
  jest.useRealTimers();
});

/** The persisted-session projection the schema's `expect.persisted.session` describes (journey B's shape). */
function sessionProjectionOf(obs: ScenarioStepObservation, key: string) {
  const session = obs.sessions.find(s => s.sessionKey === key);
  if (!session) {
    return null;
  }
  return {
    status: session.status,
    hasStartedAt: session.startedAt != null,
    exercises: session.exercises.map(ex => ({
      exercise: ex.exercise.name,
      sets: ex.sets.map(s => ({
        ...(s.setData.type === 'strength' ? { reps: s.setData.reps, weight: s.setData.weight } : {}),
      })),
    })),
  };
}

// --- the generic plane: every step of every journey meets its expectations ---

describe.each(JOURNEYS)('$id — the scripted journey', scenario => {
  const askIndex = scenario.steps.findIndex(s => s.action === 'user' && s.text.includes('вес'));
  const reportIndex = scenario.steps.length - 1; // the report step is the journey's last

  it.each(scenario.steps.map((step, index) => ({ index, step })))(
    'step $index ($step.action) meets its expectations',
    ({ index, step }) => {
      const run = runOf(scenario);
      const obs = run.result.steps[index]!;
      const failures: string[] = [];
      const check = (name: string, passed: boolean, detail = ''): void => {
        if (!passed) {
          failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
        }
      };
      const seen = run.seenByStep.get(index) ?? '';

      if (step.action === 'user') {
        check('run outcome ok', obs.runRow?.outcome === 'ok', `outcome ${obs.runRow?.outcome ?? 'no row'}`);
      }

      const called = obs.runRow?.toolCalls?.map(c => c.name) ?? [];
      for (const entry of step.expect?.tools?.must ?? []) {
        check(`tools.must ${assertionText(entry)}`, called.includes(assertionText(entry)), `called: ${called.join(', ')}`);
      }
      for (const entry of step.expect?.tools?.mustNot ?? []) {
        check(`tools.mustNot ${assertionText(entry)}`, !called.includes(assertionText(entry)));
      }
      for (const entry of step.expect?.delivered?.mustMatch ?? []) {
        check(`delivered contains "${assertionText(entry)}"`, obs.delivered.includes(assertionText(entry)));
      }
      if (step.expect?.phaseAfter) {
        check('phaseAfter', obs.phase === step.expect.phaseAfter.phase, `expected ${step.expect.phaseAfter.phase}, got ${obs.phase}`);
      }
      if (step.expect?.persisted?.turnRecorded === true) {
        check('turn recorded', obs.turnCount > 0, `turnCount ${obs.turnCount}`);
      }
      const expectedSession = step.expect?.persisted?.session;
      if (expectedSession) {
        const projection = sessionProjectionOf(obs, expectedSession.key ?? '');
        check('session present', projection != null);
        if (projection) {
          check('session status', projection.status === expectedSession.status, `got ${projection.status}`);
          if (expectedSession.hasStartedAt !== undefined) {
            check('session startedAt', projection.hasStartedAt === expectedSession.hasStartedAt);
          }
          if (expectedSession.exercises) {
            check(
              'session exercises',
              JSON.stringify(projection.exercises) === JSON.stringify(expectedSession.exercises),
              `got ${JSON.stringify(projection.exercises)}`,
            );
          }
        }
      }

      // seen — the plane only the scripted model can observe.
      if (step.action === 'user') {
        for (const entry of step.expect?.seen?.mustMatch ?? []) {
          check(`model input contains "${assertionText(entry)}"`, seen.includes(assertionText(entry)));
        }
        for (const entry of step.expect?.seen?.mustNotMatch ?? []) {
          check(`model input lacks "${assertionText(entry)}"`, !seen.includes(assertionText(entry)));
        }
      }

      expect(failures).toEqual([]);
    },
  );

  it('consumed the whole script (no fallback answer leaked in)', () => {
    expect(runOf(scenario).scriptLeftover).toBe(false);
  });

  it(`the ask turn (step ${askIndex}) is the first training turn and stays in training`, () => {
    const obs = runOf(scenario).result.steps[askIndex]!;
    expect(obs.action).toBe('user');
    expect(obs.phase).toBe('training');
  });

  it('the report set is logged at the oracle-computed load', () => {
    const caseOf = N_LOAD_CASES.find(c => c.id === scenario.id)!;
    const verdict = verdictOf(caseOf);
    const obs = runOf(scenario).result.steps[reportIndex]!;
    const expectedWeight = caseOf.reportWeight ?? verdict.expectedKg;
    expect(expectedWeight).not.toBeNull();
    const projection = sessionProjectionOf(obs, caseOf.sessionKey);
    expect(projection?.exercises).toEqual([
      { exercise: caseOf.exerciseName, sets: [{ reps: caseOf.reportReps, weight: expectedWeight }] },
    ]);
  });
});

// --- the computed expectations: what T3's live judge compares replies against ---

describe('nLoadExpectations — the computed loads of the six patterns', () => {
  it.each(nLoadExpectations())('$scenarioId → $direction $expectedKg kg (acceptable: $acceptableKg)', expectation => {
    // The scenario files were built from these same verdicts; this pins the
    // table the live judge will read, next to the journeys that seed it.
    const caseOf = N_LOAD_CASES.find(c => c.id === expectation.scenarioId)!;
    expect(verdictOf(caseOf)).toEqual(
      expect.objectContaining({
        direction: expectation.direction,
        expectedKg: expectation.expectedKg,
        acceptableKg: expectation.acceptableKg,
      }),
    );
    if (expectation.direction !== 'ask') {
      expect(expectation.expectedKg).not.toBeNull();
      expect(expectation.acceptableKg).toContain(expectation.expectedKg);
    } else {
      expect(expectation.expectedKg).toBeNull();
      expect(expectation.acceptableKg).toEqual([]);
    }
  });
});
