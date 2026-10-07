/**
 * Journeys g and h, deterministic layer (coach-quality-proof T1 / AC-CQ-1):
 * g-greeting-after-open-session (BUG-053: a seeded three-day-old in_progress
 * workout closes at «привет») and h-forgot-plank-reopen (reopen_workout +
 * two isometric sets in the old session, retro-dated to its last activity).
 * The generic plane evaluates every step's scenario expectations; the
 * journey-specific blocks pin what the schema cannot say: the close's dating
 * (completed_at = last activity), the retro offsets of the plank sets, and
 * the reopen keeping the old session's identity.
 */
import type { BaseMessage } from '@langchain/core/messages';

import { runScenario, type ScenarioRunResult, type ScenarioStepObservation } from '../../../evals/lib/run-scenario';
import {
  assertionLiveOnly,
  assertionText,
  ScenarioSchema,
  type Scenario,
  type ScenarioAssertion,
  type ScenarioStep,
} from '../../../evals/schema/scenario.schema';
import { scenario as journeyG } from '../../../evals/scenarios/g-greeting-after-open-session.scenario';
import { scenario as journeyH } from '../../../evals/scenarios/h-forgot-plank-reopen.scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

const JOURNEYS: Scenario[] = [journeyG, journeyH];

const textOf = (m: BaseMessage | undefined): string => {
  const content = m?.content;
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
};

let model: ScriptedModelHandle;
const runs = new Map<string, { result: ScenarioRunResult; seenByStep: Map<number, string> }>();
const runOf = (scenario: Scenario) => runs.get(scenario.id)!;

/** The graph reads it at composition (same-run chat → training hand-off, journey c's precedent). */
let previousHandoff: string | undefined;

beforeAll(async () => {
  previousHandoff = process.env.TRANSITION_HANDOFF_TARGETS;
  process.env.TRANSITION_HANDOFF_TARGETS = 'training,session_planning';
  for (const scenario of JOURNEYS) {
    expect(ScenarioSchema.parse(scenario)).toBeTruthy(); // every journey is format-valid
  }
  model = installScriptedModel();
  jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
  jest.setSystemTime(new Date('2026-10-08T10:00:00.000Z'));
  for (const scenario of JOURNEYS) {
    model.reset();
    const userSteps = scenario.steps.filter((s): s is Extract<ScenarioStep, { action: 'user' }> => s.action === 'user');
    for (const step of userSteps) {
      model.enqueueChat(step.script ?? []);
    }
    const seenByStep = new Map<number, string>();
    const result = await runScenario(scenario, {
      onAdvance: () => undefined,
      onStep: obs => {
        if (obs.action !== 'user') {
          return;
        }
        seenByStep.set(obs.stepIndex, model.drainChatInputs().flat().map(m => textOf(m)).join('\n'));
      },
    });
    runs.set(scenario.id, { result, seenByStep });
  }
}, 600_000);

afterAll(() => {
  jest.useRealTimers();
  if (previousHandoff === undefined) {
    delete process.env.TRANSITION_HANDOFF_TARGETS;
  } else {
    process.env.TRANSITION_HANDOFF_TARGETS = previousHandoff;
  }
});

/** The persisted-session projection the schema's `expect.persisted.session` describes. */
function sessionProjectionOf(obs: ScenarioStepObservation, key: string) {
  const session = obs.sessions.find(s => s.sessionKey === key);
  if (!session) {
    return null;
  }
  return {
    status: session.status,
    hasCompletedAt: session.completedAt != null,
    autoCloseReason: session.autoCloseReason ?? null,
    exercises: session.exercises.map(ex => ({
      exercise: ex.exercise.name,
      sets: ex.sets.map(s => ({
        ...(s.setData.type === 'strength' ? { reps: s.setData.reps, weight: s.setData.weight } : {}),
        ...(s.setData.type === 'functional_reps' ? { reps: s.setData.reps } : {}),
        ...(s.setData.type === 'isometric' ? { durationSeconds: s.setData.duration } : {}),
      })),
    })),
  };
}

const deterministic = (entries: ScenarioAssertion[] | undefined): string[] =>
  (entries ?? []).filter(e => !assertionLiveOnly(e)).map(assertionText);

describe.each(JOURNEYS)('$id — the scripted journey', scenario => {
  it.each(scenario.steps.map((step, index) => ({ index, step })))(
    'step $index ($step.action) meets its expectations',
    ({ index, step }) => {
      const { result, seenByStep } = runOf(scenario);
      const obs = result.steps[index]!;
      const failures: string[] = [];
      const check = (name: string, passed: boolean, detail = ''): void => {
        if (!passed) {
          failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
        }
      };

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
      for (const text of deterministic(step.expect?.delivered?.mustMatch)) {
        check(`delivered contains "${text}"`, obs.delivered.includes(text));
      }
      for (const text of deterministic(step.expect?.delivered?.mustNotMatch)) {
        check(`delivered lacks "${text}"`, !obs.delivered.includes(text));
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
          if (expectedSession.hasCompletedAt !== undefined) {
            check('session completedAt', projection.hasCompletedAt === expectedSession.hasCompletedAt);
          }
          if (expectedSession.autoCloseReason !== undefined) {
            check(
              'session autoCloseReason',
              projection.autoCloseReason === expectedSession.autoCloseReason,
              `got ${String(projection.autoCloseReason)}`,
            );
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
      if (step.action === 'user') {
        const seen = seenByStep.get(index) ?? '';
        for (const entry of step.expect?.seen?.mustMatch ?? []) {
          check(`model input contains "${assertionText(entry)}"`, seen.includes(assertionText(entry)));
        }
      }

      expect(failures).toEqual([]);
    },
  );

  it('consumed the whole script (no fallback answer leaked in)', () => {
    expect(model.chatScriptExhausted).toBe(true);
  });
});

describe('g — the close is dated to the last activity, not the return', () => {
  it('completed_at = last_activity_at, both three days before the greeting', () => {
    const session = runOf(journeyG).result.steps[0]!.sessions.find(s => s.sessionKey === 'upper_a')!;
    expect(session.status).toBe('completed');
    expect(session.autoCloseReason).toBe('timeout');
    expect(session.completedAt?.getTime()).toBe(session.lastActivityAt?.getTime());
    // The seed's activity is the started-at + the seeded hour: exactly T0 − 3 d + 60 min.
    expect(result0t0().getTime() - session.completedAt!.getTime()).toBe(3 * 24 * 3600_000 - 60 * 60_000);
  });

  it('the greeting turn ran no tool (a text-only chat answer)', () => {
    expect(runOf(journeyG).result.steps[0]!.runRow?.toolCalls ?? []).toEqual([]);
  });
});

function result0t0(): Date {
  return runOf(journeyG).result.t0;
}

describe('h — the reopened old session keeps its identity and the retro dating', () => {
  it('the plank sets land in the SAME session (no new one), retro-dated to its last activity', () => {
    const sessions = runOf(journeyH).result.steps[1]!.sessions;
    expect(sessions).toHaveLength(1); // the reopened upper_a — nothing else was ever started
    const session = sessions[0]!;
    expect(session.sessionKey).toBe('upper_a');
    expect(session.status).toBe('in_progress');
    const plank = session.exercises.find(ex => ex.exercise.name === 'Plank')!;
    expect(plank.sets).toHaveLength(2);
    // BR-TRAINING-030, journey c's precedent: EVERY retro set is dated to the last
    // activity + RETRO_SET_OFFSET_MS — the retro stamp, not a chained offset.
    const base = session.lastActivityAt!.getTime();
    expect(plank.sets[0]!.createdAt.getTime()).toBe(base + 5 * 60_000);
    expect(plank.sets[1]!.createdAt.getTime()).toBe(base + 5 * 60_000);
  });

  it('the reopen turn used the old session id as the active session again', () => {
    const greeting = runOf(journeyH).result.steps[0]!.sessions.find(s => s.sessionKey === 'upper_a')!;
    const after = runOf(journeyH).result.steps[1]!.sessions.find(s => s.sessionKey === 'upper_a')!;
    expect(after.id).toBe(greeting.id);
  });
});
