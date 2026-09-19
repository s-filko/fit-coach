/**
 * Journey C, deterministic layer (training-journey-scenarios plan, Task 5 /
 * AC-TJ-2, AC-TJ-3): an interrupted workout over the real test database —
 * journey B's setup steps (imported, not copied) → two bench sets → a
 * text-only rest question → a +3.5 h pause (past EPISODE_GAP_HOURS) →
 * "вернулся, доделаю" → a retro third set → `finish_training`. After the
 * pause the training phase re-reads the session from the DB: STALE SESSION
 * plus a WORKOUT OVERVIEW still listing the pre-pause sets.
 *
 * `beforeAll` runs the journey once (real wiring via `runScenario`, Date-only
 * fake timers); per-step `seen` is attributed through the runner's `onStep`
 * hook. The BUG-018 points fail today and run as `test.failing` (owner rule:
 * reproduction before fixes); everything else must pass.
 */
import { eq } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { conversationTurns } from '@infra/db/schema';
import type { BaseMessage } from '@langchain/core/messages';

import { runScenario, type ScenarioRunResult, type ScenarioStepObservation } from '../../../evals/lib/run-scenario';
import {
  assertionKnownBug,
  assertionText,
  ScenarioSchema,
  type ScenarioAssertion,
  type ScenarioStep,
  type TaggedAssertion,
} from '../../../evals/schema/scenario.schema';
import { scenario } from '../../../evals/scenarios/c-interrupted-workout.scenario';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

/** The scenario's "3 hours" stale label and its 11-minute duration are pinned to this T0. */
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

function textOf(m: BaseMessage | undefined): string {
  const content = m?.content;
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
}

/** The user steps, indexed by their position in `scenario.steps`. */
type UserStep = Extract<ScenarioStep, { action: 'user' }>;
const userSteps: Array<{ step: UserStep; index: number }> = [];
scenario.steps.forEach((step, index) => {
  if (step.action === 'user') {
    userSteps.push({ step, index });
  }
});
const stepAt = (index: number): UserStep => {
  const found = userSteps.find(s => s.index === index);
  if (!found) {
    throw new Error(`journey C: step ${index} must be a user step`);
  }
  return found.step;
};

let model: ScriptedModelHandle;
let result: ScenarioRunResult;
/** Everything the model was handed, per user step (one string per step). */
const seenByStep = new Map<number, string>();

beforeAll(async () => {
  expect(ScenarioSchema.parse(scenario)).toBeTruthy(); // the scenario is format-valid
  model = installScriptedModel();
  jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
  jest.setSystemTime(T0);
  for (const { step } of userSteps) {
    model.enqueueChat(step.action === 'user' ? (step.script ?? []) : []);
  }

  result = await runScenario(scenario, {
    onAdvance: now => jest.setSystemTime(now),
    // Drain at each step boundary so `seen` stays attributed to its step.
    onStep: (obs: ScenarioStepObservation) => {
      if (obs.action !== 'user') {
        return;
      }
      const calls = model.drainChatInputs();
      seenByStep.set(obs.stepIndex, calls.flat().map(m => textOf(m)).join('\n'));
    },
  });
});

afterAll(() => {
  jest.useRealTimers();
});

const seenOf = (index: number): string => {
  const seen = seenByStep.get(index);
  if (seen === undefined) {
    throw new Error(`journey C: no seen observation for user step ${index}`);
  }
  return seen;
};

const observationOf = (index: number): ScenarioStepObservation => {
  const obs = result.steps[index];
  if (!obs || obs.action !== 'user') {
    throw new Error(`journey C: no user-step observation at index ${index}`);
  }
  return obs;
};

/** The user's current `upper_a` session (newest-first snapshot → first match). */
function upperASessionOf(index: number) {
  const sessions = observationOf(index).sessions.filter(s => s.sessionKey === 'upper_a');
  const [current] = sessions;
  if (!current) {
    throw new Error(`journey C: no upper_a session in the step-${index} snapshot`);
  }
  return current;
}

/** The persisted-session projection the schema's `expect.persisted.session` describes. */
function persistedProjection(session: ReturnType<typeof upperASessionOf>) {
  return {
    key: session.sessionKey,
    status: session.status,
    hasStartedAt: session.startedAt != null,
    hasCompletedAt: session.completedAt != null,
    durationMinutes: session.durationMinutes ?? null,
    exercises: session.exercises.map(ex => ({
      exercise: ex.exercise.name,
      sets: ex.sets.map(s => ({
        reps: (s.setData as { reps?: number }).reps,
        ...(s.setData.type === 'strength' ? { weight: s.setData.weight } : {}),
      })),
    })),
  };
}

async function turnCountOf(index: number): Promise<number> {
  const runRow = observationOf(index).runRow;
  if (!runRow) {
    return 0;
  }
  const turns = await db
    .select({ id: conversationTurns.id })
    .from(conversationTurns)
    .where(eq(conversationTurns.runId, runRow.runId));
  return turns.length;
}

/** Runs every entry of one expectations plane: bare strings as passing tests,
 * tagged entries as `test.failing` (per-assertion knownBug, Task 4 Step 0). */
function itEntries(
  suiteName: string,
  index: number,
  entries: ScenarioAssertion[] | undefined,
  actualOf: () => string,
): void {
  if (!entries || entries.length === 0) {
    return;
  }
  describe(`${suiteName} — step ${index}`, () => {
    const passing = entries.filter(e => assertionKnownBug(e) === null);
    const failing = entries.filter((e): e is TaggedAssertion => assertionKnownBug(e) !== null);

    it.each(passing.map(assertionText))('%s', substring => {
      expect(actualOf()).toContain(substring);
    });

    for (const entry of failing) {
      test.failing(`contains "${entry.text}" [${entry.knownBug}]`, () => {
        expect(actualOf()).toContain(entry.text);
      });
    }
  });
}

describe('journey C — an interrupted workout', () => {
  // --- steps 0–2: journey B's imported setup (greeting → planning → start) ---
  describe('step 0 — "привет, хочу потренироваться" (imported setup)', () => {
    it('the run row records the request_transition tool call and the applied transition', () => {
      const runRow = observationOf(0).runRow;
      expect(runRow).not.toBeNull();
      expect(runRow!.phaseIn).toBe('chat');
      expect(runRow!.phaseOut).toBe('session_planning');
      expect(runRow!.toolCalls?.map(c => c.name)).toContain('request_transition');
    });

    it('conversation_turns rows link to this run', async () => {
      expect(await turnCountOf(0)).toBeGreaterThan(0);
    });
  });

  describe('step 1 — "давай верх" (imported setup)', () => {
    itEntries('seen', 1, stepAt(1).expect?.seen?.mustMatch, () => seenOf(1));
    itEntries('delivered', 1, stepAt(1).expect?.delivered?.mustMatch, () => observationOf(1).delivered);
  });

  describe('step 2 — "да, поехали" (imported setup)', () => {
    it('the session is in_progress with a startedAt (the duration clock starts here)', () => {
      const session = persistedProjection(upperASessionOf(2));
      expect(session.key).toBe('upper_a');
      expect(session.status).toBe('in_progress');
      expect(session.hasStartedAt).toBe(true);
    });

    it('phase after the step is training', () => {
      expect(observationOf(2).phase).toBe('training');
    });
  });

  // --- step 4: bench set 1 ---
  describe('step 4 — bench set 1', () => {
    itEntries('seen', 4, stepAt(4).expect?.seen?.mustMatch, () => seenOf(4));
    itEntries('delivered', 4, stepAt(4).expect?.delivered?.mustMatch, () => observationOf(4).delivered);

    it('log_set was called (the run row keeps only args hashes; the persisted set below is the effect)', () => {
      expect(observationOf(4).runRow?.toolCalls?.map(c => c.name)).toContain('log_set');
    });

    it('the set is persisted in order', () => {
      expect(persistedProjection(upperASessionOf(4)).exercises).toEqual([
        { exercise: 'Barbell Bench Press', sets: [{ reps: 8, weight: 80 }] },
      ]);
    });
  });

  // --- step 6: bench set 2 ---
  describe('step 6 — bench set 2', () => {
    itEntries('seen', 6, stepAt(6).expect?.seen?.mustMatch, () => seenOf(6));
    itEntries('delivered', 6, stepAt(6).expect?.delivered?.mustMatch, () => observationOf(6).delivered);

    it('both bench sets are persisted in order', () => {
      expect(persistedProjection(upperASessionOf(6)).exercises).toEqual([
        {
          exercise: 'Barbell Bench Press',
          sets: [
            { reps: 8, weight: 80 },
            { reps: 8, weight: 80 },
          ],
        },
      ]);
    });
  });

  // --- step 7: the mid-workout rest question — text only, no tool ---
  describe('step 7 — the rest question (text-only answer)', () => {
    itEntries('seen', 7, stepAt(7).expect?.seen?.mustMatch, () => seenOf(7));
    itEntries('delivered', 7, stepAt(7).expect?.delivered?.mustMatch, () => observationOf(7).delivered);

    it('no tool call and no transition — the run row is clean', () => {
      const runRow = observationOf(7).runRow;
      expect(runRow).not.toBeNull();
      expect(runRow!.toolCalls ?? []).toEqual([]);
      expect(runRow!.transition).toBeNull();
      expect(runRow!.phaseOut).toBeNull();
    });

    it('the session is untouched (still the two pre-question sets)', () => {
      expect(persistedProjection(upperASessionOf(7)).exercises).toEqual([
        {
          exercise: 'Barbell Bench Press',
          sets: [
            { reps: 8, weight: 80 },
            { reps: 8, weight: 80 },
          ],
        },
      ]);
    });

    it('conversation_turns rows link to this run', async () => {
      expect(await turnCountOf(7)).toBeGreaterThan(0);
    });

    it('phase stays training', () => {
      expect(observationOf(7).phase).toBe('training');
    });
  });

  // --- step 9: the return after +3.5 h ---
  describe('step 9 — "вернулся, доделаю" (after the +3.5 h pause)', () => {
    itEntries('seen', 9, stepAt(9).expect?.seen?.mustMatch, () => seenOf(9));
    itEntries('delivered', 9, stepAt(9).expect?.delivered?.mustMatch, () => observationOf(9).delivered);

    it('the return run records no tool call (the model just welcomes the user back)', () => {
      const runRow = observationOf(9).runRow;
      expect(runRow!.toolCalls ?? []).toEqual([]);
      expect(runRow!.transition).toBeNull();
    });

    it('conversation_turns rows link to this run', async () => {
      expect(await turnCountOf(9)).toBeGreaterThan(0);
    });

    it('phase stays training (prepare did not bounce the run to chat)', () => {
      expect(observationOf(9).phase).toBe('training');
    });
  });

  // --- step 11: the third set — retro-logged ---
  describe('step 11 — the third set (retro-logged)', () => {
    itEntries('seen', 11, stepAt(11).expect?.seen?.mustMatch, () => seenOf(11));
    itEntries('delivered', 11, stepAt(11).expect?.delivered?.mustMatch, () => observationOf(11).delivered);

    it('log_set was called', () => {
      expect(observationOf(11).runRow?.toolCalls?.map(c => c.name)).toContain('log_set');
    });

    it('all three bench sets are persisted in order', () => {
      expect(persistedProjection(upperASessionOf(11)).exercises).toEqual([
        {
          exercise: 'Barbell Bench Press',
          sets: [
            { reps: 8, weight: 80 },
            { reps: 8, weight: 80 },
            { reps: 8, weight: 80 },
          ],
        },
      ]);
    });

    it('phase stays training', () => {
      expect(observationOf(11).phase).toBe('training');
    });
  });

  // --- step 13: finish ---
  describe('step 13 — "всё, доделал" (finish_training)', () => {
    it('finish_training was called', () => {
      expect(observationOf(13).runRow?.toolCalls?.map(c => c.name)).toContain('finish_training');
    });

    it('the session is completed with the retro-completed window (not the wall clock)', () => {
      const raw = upperASessionOf(13);
      const session = persistedProjection(raw);
      expect(session.status).toBe('completed');
      expect(session.durationMinutes).toBe(11);
      expect(session.hasCompletedAt).toBe(true);
      // The third set was retro (skipActivityUpdate), so the session stayed
      // stale and finish_training completed it AT the last real activity —
      // set 2 at T0+12m — not at the +3h46m finish clock.
      expect(raw.completedAt!.getTime() - raw.startedAt!.getTime()).toBeGreaterThanOrEqual(11 * 60_000);
      expect(raw.completedAt!.getTime() - raw.startedAt!.getTime()).toBeLessThan(12.5 * 60_000);
    });

    it('the run row records the applied transition back to chat', () => {
      const runRow = observationOf(13).runRow;
      expect(runRow!.phaseOut).toBe('chat');
      expect(runRow!.transition).toEqual(expect.objectContaining({ toPhase: 'chat' }));
    });

    it('conversation_turns rows link to this run', async () => {
      expect(await turnCountOf(13)).toBeGreaterThan(0);
    });

    itEntries('delivered', 13, stepAt(13).expect?.delivered?.mustMatch, () => observationOf(13).delivered);

    it('phase after the step is chat', () => {
      expect(observationOf(13).phase).toBe('chat');
    });
  });

  it('consumed the whole script (no fallback answer leaked in)', () => {
    expect(model.chatScriptExhausted).toBe(true);
  });
});
