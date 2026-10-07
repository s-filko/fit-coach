/**
 * The T1 weight-logging journeys, deterministic layer (coach-quality-proof T1 /
 * AC-CQ-1): i-weight-shorthand, j-bodyweight, k-weight-unknown, l-correction,
 * m-no-false-log over the real test database, one scripted run each. The
 * journeys pin the BR-TRAINING-047 behaviour merged from plan-and-tool-fixes
 * T6 (weight required with reps, 0 = bodyweight, the code never derives a
 * weight) plus the BUG-052 reproduction in plan_creation.
 *
 * The generic plane evaluates every step's scenario expectations (tools,
 * delivered, phaseAfter, persisted session, seen); `liveOnly` entries are
 * skipped (only the live L3 layer can check them) and `knownBug` entries run
 * as the dedicated test.failing block at the bottom (reproduction before fix).
 */
import type { BaseMessage } from '@langchain/core/messages';

import { runScenario, type ScenarioRunResult, type ScenarioStepObservation } from '../../../evals/lib/run-scenario';
import {
  assertionKnownBug,
  assertionLiveOnly,
  assertionText,
  ScenarioSchema,
  type Scenario,
  type ScenarioAssertion,
  type ScenarioStep,
} from '../../../evals/schema/scenario.schema';
import { scenario as journeyI } from '../../../evals/scenarios/i-weight-shorthand.scenario';
import { scenario as journeyJ } from '../../../evals/scenarios/j-bodyweight.scenario';
import { scenario as journeyK } from '../../../evals/scenarios/k-weight-unknown.scenario';
import { scenario as journeyL } from '../../../evals/scenarios/l-correction.scenario';
import { scenario as journeyM } from '../../../evals/scenarios/m-no-false-log.scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

const JOURNEYS: Scenario[] = [journeyI, journeyJ, journeyK, journeyL, journeyM];

const textOf = (m: BaseMessage | undefined): string => {
  const content = m?.content;
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
};

interface JourneyRun {
  result: ScenarioRunResult;
  seenByStep: Map<number, string>;
  scriptLeftover: boolean;
}

let model: ScriptedModelHandle;
const runs = new Map<string, JourneyRun>();
const runOf = (scenario: Scenario): JourneyRun => runs.get(scenario.id)!;

async function runJourney(scenario: Scenario): Promise<JourneyRun> {
  model.reset();
  jest.setSystemTime(new Date());
  const userSteps = scenario.steps.filter((s): s is Extract<ScenarioStep, { action: 'user' }> => s.action === 'user');
  for (const step of userSteps) {
    model.enqueueChat(step.script ?? []);
  }
  const seenByStep = new Map<number, string>();
  const result = await runScenario(scenario, {
    onAdvance: () => undefined, // the journeys' pinned strings carry no clock-dependent labels
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
        ...(s.setData.type === 'functional_reps' ? { reps: s.setData.reps } : {}),
      })),
    })),
  };
}

// --- the generic plane: every step of every journey meets its expectations ---

describe.each(JOURNEYS)('$id — the scripted journey', scenario => {
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
      // liveOnly entries exist for the live L3 layer; knownBug ones run below as test.failing.
      const deterministicText = (entries: ScenarioAssertion[]) =>
        entries.filter(e => !assertionLiveOnly(e) && assertionKnownBug(e) === null).map(assertionText);
      for (const text of deterministicText(step.expect?.delivered?.mustMatch ?? [])) {
        check(`delivered contains "${text}"`, obs.delivered.includes(text));
      }
      for (const text of deterministicText(step.expect?.delivered?.mustNotMatch ?? [])) {
        check(`delivered lacks "${text}"`, !obs.delivered.includes(text));
      }
      if (step.expect?.phaseAfter) {
        check(
          'phaseAfter',
          obs.phase === step.expect.phaseAfter.phase,
          `expected ${step.expect.phaseAfter.phase}, got ${obs.phase}`,
        );
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
});

// --- journey-specific pins ---

describe('k-weight-unknown — the schema rejection', () => {
  it('the reps-only log_set call is recorded as an llm_error (nothing executed)', () => {
    const obs = runOf(JOURNEYS.find(s => s.id === 'k-weight-unknown')!).result.steps[3]!;
    const call = obs.runRow?.toolCalls?.find(c => c.name === 'log_set');
    expect(call).toBeDefined();
    expect(call?.outcomeKind).toBe('llm_error');
  });
});

describe('m-no-false-log — the BUG-052 reproduction', () => {
  // The scripted reply claims logging; the assertion that must hold once
  // BUG-052 is fixed fails today, so it runs as test.failing (reproduction
  // before fix — plan § T1 tags it knownBug until then).
  test.failing('step 1 does not claim the set was logged [BUG-052]', () => {
    const obs = runOf(JOURNEYS.find(s => s.id === 'm-no-false-log')!).result.steps[1]!;
    expect(obs.delivered.includes('Записал')).toBe(false);
  });

  it('step 1 stores nothing — plan_creation has no logging tool', () => {
    const obs = runOf(JOURNEYS.find(s => s.id === 'm-no-false-log')!).result.steps[1]!;
    expect(obs.runRow?.toolCalls ?? []).toEqual([]);
    expect(obs.sessions).toEqual([]); // no session was ever started
  });
});
