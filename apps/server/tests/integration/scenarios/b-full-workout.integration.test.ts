/**
 * Journey B, deterministic layer (training-journey-scenarios plan, Task 4 /
 * AC-TJ-2, AC-TJ-3): a full workout over the real test database — greeting →
 * session_planning → proposal → `start_training_session` → bench sets →
 * pull-up sets (the switch auto-completes bench) → `finish_training` →
 * "спасибо" back in chat. Past workouts with weights, an active plan and one
 * fact are seeded as rows; the scripted model carries "Записал!" and the
 * `log_set` call in one AI message (the AC-CC-3 shape).
 *
 * `beforeAll` runs the journey once (real wiring via `runScenario`, Date-only
 * fake timers); per-step `seen` is attributed through the runner's `onStep`
 * hook. The BUG-018 points are fixed (chat-continuity Tasks 1-3) and run as
 * plain tests; the knownBug machinery stays for any future reproduction.
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
import { BENCH_PRESS_ID, PULL_UPS_ID, scenario } from '../../../evals/scenarios/b-full-workout.scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

/** The scenario's weekday labels and its 20-minute duration are pinned to this T0. */
const T0 = new Date('2026-09-20T10:00:00.000Z');

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
    throw new Error(`journey B: step ${index} must be a user step`);
  }
  return found.step;
};

let model: ScriptedModelHandle;
let result: ScenarioRunResult;
/** Everything the model was handed, per user step (one string per step). */
const seenByStep = new Map<number, string>();
/** The same observation per user step, unflattened — ordered-message checks read it. */
const callsByStep = new Map<number, BaseMessage[][]>();

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
      callsByStep.set(obs.stepIndex, calls);
      seenByStep.set(
        obs.stepIndex,
        calls
          .flat()
          .map(m => textOf(m))
          .join('\n'),
      );
    },
  });
});

afterAll(() => {
  jest.useRealTimers();
});

const seenOf = (index: number): string => {
  const seen = seenByStep.get(index);
  if (seen === undefined) {
    throw new Error(`journey B: no seen observation for user step ${index}`);
  }
  return seen;
};

const observationOf = (index: number): ScenarioStepObservation => {
  const obs = result.steps[index];
  if (!obs || obs.action !== 'user') {
    throw new Error(`journey B: no user-step observation at index ${index}`);
  }
  return obs;
};

/** The user's current `upper_a` session (newest-first snapshot → first match). */
function upperASessionOf(index: number) {
  const sessions = observationOf(index).sessions.filter(s => s.sessionKey === 'upper_a');
  const [current] = sessions;
  if (!current) {
    throw new Error(`journey B: no upper_a session in the step-${index} snapshot`);
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

describe('journey B — a full workout, greeting to finish', () => {
  // --- step 0: greeting → session_planning ---
  describe('step 0 — "привет, хочу потренироваться"', () => {
    it('the run row records the request_transition tool call and the applied transition', () => {
      const runRow = observationOf(0).runRow;
      expect(runRow).not.toBeNull();
      expect(runRow!.phaseIn).toBe('chat');
      expect(runRow!.phaseOut).toBe('session_planning');
      expect(runRow!.toolCalls?.map(c => c.name)).toContain('request_transition');
      expect(runRow!.transition).toEqual(expect.objectContaining({ toPhase: 'session_planning' }));
    });

    it('conversation_turns rows link to this run', async () => {
      expect(await turnCountOf(0)).toBeGreaterThan(0);
    });

    it('phase after the step is session_planning', () => {
      expect(observationOf(0).phase).toBe('session_planning');
    });
  });

  // --- step 1: the proposal over history, recovery and the active plan ---
  describe('step 1 — "давай верх" (the proposal)', () => {
    itEntries('seen', 1, stepAt(1).expect?.seen?.mustMatch, () => seenOf(1));
    itEntries('delivered', 1, stepAt(1).expect?.delivered?.mustMatch, () => observationOf(1).delivered);

    it('the proposal lists the plan the model was shown', () => {
      expect(observationOf(1).delivered).toContain('жим лёжа 3×8-10 @ 80 кг');
    });

    it('conversation_turns rows link to this run', async () => {
      expect(await turnCountOf(1)).toBeGreaterThan(0);
    });

    it('phase stays session_planning', () => {
      expect(observationOf(1).phase).toBe('session_planning');
    });
  });

  // --- step 2: start_training_session ---
  describe('step 2 — "да, поехали" (start_training_session)', () => {
    it('the tool was called', () => {
      expect(observationOf(2).runRow?.toolCalls?.map(c => c.name)).toContain('start_training_session');
    });

    it('the session stores the plan session key and the plan exercise IDs (the run row keeps only args hashes)', () => {
      const session = upperASessionOf(2);
      expect(session.sessionPlanJson?.sessionKey).toBe('upper_a');
      expect(session.sessionPlanJson?.exercises.map(e => e.exerciseId)).toEqual([BENCH_PRESS_ID, PULL_UPS_ID]);
    });

    it('the session is in_progress with a startedAt', () => {
      const session = persistedProjection(upperASessionOf(2));
      expect(session.key).toBe('upper_a');
      expect(session.status).toBe('in_progress');
      expect(session.hasStartedAt).toBe(true);
    });

    it('the run row records the applied transition to training', () => {
      const runRow = observationOf(2).runRow;
      expect(runRow!.phaseOut).toBe('training');
      expect(runRow!.transition).toEqual(expect.objectContaining({ toPhase: 'training' }));
    });

    itEntries('delivered', 2, stepAt(2).expect?.delivered?.mustMatch, () => observationOf(2).delivered);

    it('phase after the step is training', () => {
      expect(observationOf(2).phase).toBe('training');
    });
  });

  // --- step 4: bench set 1 — "Записал!" + log_set in ONE AI message ---
  describe('step 4 — bench set 1 ("Записал!" + log_set in one AI message)', () => {
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

    it('the delivered text is every AI text of the run, in order (AC-CC-3)', () => {
      // Mirror of journey A: the "Записал!" written alongside the tool call
      // is delivered before the after-tool text.
      expect(observationOf(4).delivered).toBe(`Записал!\n\nОтлично, есть первый подход!`);
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

  // --- step 8: pull-up set 1 — the switch auto-completes bench ---
  describe('step 8 — pull-up set 1 (bench auto-completes)', () => {
    itEntries('delivered', 8, stepAt(8).expect?.delivered?.mustMatch, () => observationOf(8).delivered);

    it('log_set was called', () => {
      expect(observationOf(8).runRow?.toolCalls?.map(c => c.name)).toContain('log_set');
    });

    it('bench keeps its sets and pull-ups joins in_progress', () => {
      expect(persistedProjection(upperASessionOf(8)).exercises).toEqual([
        {
          exercise: 'Barbell Bench Press',
          sets: [
            { reps: 8, weight: 80 },
            { reps: 8, weight: 80 },
          ],
        },
        { exercise: 'Pull-ups', sets: [{ reps: 8 }] },
      ]);
    });
  });

  // --- step 10: pull-up set 2 ---
  describe('step 10 — pull-up set 2 (bench DONE in the overview)', () => {
    itEntries('seen', 10, stepAt(10).expect?.seen?.mustMatch, () => seenOf(10));
    itEntries('delivered', 10, stepAt(10).expect?.delivered?.mustMatch, () => observationOf(10).delivered);

    it('all four sets are persisted in order', () => {
      expect(persistedProjection(upperASessionOf(10)).exercises).toEqual([
        {
          exercise: 'Barbell Bench Press',
          sets: [
            { reps: 8, weight: 80 },
            { reps: 8, weight: 80 },
          ],
        },
        {
          exercise: 'Pull-ups',
          sets: [{ reps: 8 }, { reps: 8 }],
        },
      ]);
    });
  });

  // --- step 12: finish ---
  describe('step 12 — "всё, закончил" (finish_training)', () => {
    it('finish_training was called', () => {
      expect(observationOf(12).runRow?.toolCalls?.map(c => c.name)).toContain('finish_training');
    });

    it('the session is completed with durationMinutes and completedAt', () => {
      const session = persistedProjection(upperASessionOf(12));
      expect(session.status).toBe('completed');
      expect(session.durationMinutes).toBe(20);
      expect(session.hasCompletedAt).toBe(true);
      expect(session.exercises).toEqual([
        {
          exercise: 'Barbell Bench Press',
          sets: [
            { reps: 8, weight: 80 },
            { reps: 8, weight: 80 },
          ],
        },
        {
          exercise: 'Pull-ups',
          sets: [{ reps: 8 }, { reps: 8 }],
        },
      ]);
    });

    it('the run row records the applied transition back to chat', () => {
      const runRow = observationOf(12).runRow;
      expect(runRow!.phaseOut).toBe('chat');
      expect(runRow!.transition).toEqual(expect.objectContaining({ toPhase: 'chat' }));
    });

    it('conversation_turns rows link to this run', async () => {
      expect(await turnCountOf(12)).toBeGreaterThan(0);
    });

    itEntries('delivered', 12, stepAt(12).expect?.delivered?.mustMatch, () => observationOf(12).delivered);

    it('phase after the step is chat', () => {
      expect(observationOf(12).phase).toBe('chat');
    });
  });

  // --- step 13: "спасибо" back in chat ---
  describe('step 13 — "спасибо" (the new workout leads the history)', () => {
    itEntries('seen', 13, stepAt(13).expect?.seen?.mustMatch, () => seenOf(13));
    itEntries('delivered', 13, stepAt(13).expect?.delivered?.mustMatch, () => observationOf(13).delivered);

    it('the chat history block lists the new workout before the seeded ones', () => {
      const contextMessage = (callsByStep.get(13) ?? [])
        .flat()
        .find(m => textOf(m).includes('RECENT TRAINING HISTORY (last 5 sessions):'));
      expect(contextMessage).toBeDefined();
      const text = textOf(contextMessage);
      const newWorkout = text.indexOf('- upper_a — today (Sun) afternoon, 20 min');
      const seededLower = text.indexOf('- lower_a — 2d ago (Fri) afternoon');
      expect(newWorkout).toBeGreaterThanOrEqual(0);
      expect(seededLower).toBeGreaterThan(newWorkout);
    });
  });

  it('consumed the whole script (no fallback answer leaked in)', () => {
    expect(model.chatScriptExhausted).toBe(true);
  });
});
