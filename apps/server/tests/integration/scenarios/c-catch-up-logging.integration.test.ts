/**
 * Journey C, deterministic layer (training-journey-scenarios plan, Task 5b /
 * AC-TJ-2, AC-TJ-3): catch-up logging after a +3.5 h pause over the real test
 * database — journey B's setup steps (imported, not copied) → two bench sets →
 * a text-only rest question → a +3.5 h pause (past EPISODE_GAP_HOURS and the
 * 2 h session timeout) → the catch-up message.
 *
 * BUG-053 (stale-session-autoclose plan T5, owner decision 2026-10-08): at the
 * catch-up message the stale session is COMPLETED by the timeout auto-close
 * (`auto_close_reason = 'timeout'`, `completed_at` = the last pre-pause
 * activity) and CHAT answers the message; the missed pull-ups are added to that
 * finished workout in place by `edit_last_workout` (it stays completed, its
 * times unchanged, each set at last activity + `RETRO_SET_OFFSET_MS`). Both
 * catch-up wordings — implicit ("забыл дописать…") and explicit ("добавь к
 * последней тренировке…") — come from one journey builder in the scenario
 * module; this file runs each variant end to end and asserts the SAME
 * persisted outcome for both.
 *
 * `beforeAll` (per variant) runs the journey once (real wiring via
 * `runScenario`, Date-only fake timers); per-step `seen` is attributed through
 * the runner's `onStep` hook. The BUG-018 points are fixed (chat-continuity
 * Tasks 1-3) and run as plain tests; `liveOnly` entries
 * (what a REAL model must reply — the L3 layer, Task 6) are skipped here;
 * everything else must pass.
 */
import { eq } from 'drizzle-orm';

import { RETRO_SET_OFFSET_MS } from '@domain/training/session-timing';

import { db } from '@infra/db/drizzle';
import { conversationTurns } from '@infra/db/schema';
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
  type TaggedAssertion,
} from '../../../evals/schema/scenario.schema';
import { explicitScenario, scenario } from '../../../evals/scenarios/c-catch-up-logging.scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

/** The scenario's "3 hours" stale label and its 11-minute duration are pinned to this T0. */
const T0 = new Date('2026-09-20T10:00:00.000Z');

function textOf(m: BaseMessage | undefined): string {
  const content = m?.content;
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
}

/** The user steps, indexed by their position in a scenario's `steps`. */
type UserStep = Extract<ScenarioStep, { action: 'user' }>;
function userStepsOf(scenarioDef: Scenario): Array<{ step: UserStep; index: number }> {
  const userSteps: Array<{ step: UserStep; index: number }> = [];
  scenarioDef.steps.forEach((step, index) => {
    if (step.action === 'user') {
      userSteps.push({ step, index });
    }
  });
  return userSteps;
}

/** Runs one variant end to end over the real test DB and records per-step `seen`. */
async function runJourney(scenarioDef: Scenario): Promise<{
  result: ScenarioRunResult;
  seenByStep: Map<number, string>;
  model: ScriptedModelHandle;
}> {
  expect(ScenarioSchema.parse(scenarioDef)).toBeTruthy(); // the scenario is format-valid
  const model = installScriptedModel();
  const userSteps = userStepsOf(scenarioDef);
  for (const { step } of userSteps) {
    model.enqueueChat(step.script ?? []);
  }
  const seenByStep = new Map<number, string>();
  const result = await runScenario(scenarioDef, {
    onAdvance: now => jest.setSystemTime(now),
    // Drain at each step boundary so `seen` stays attributed to its step.
    onStep: (obs: ScenarioStepObservation) => {
      if (obs.action !== 'user') {
        return;
      }
      const calls = model.drainChatInputs();
      seenByStep.set(
        obs.stepIndex,
        calls
          .flat()
          .map(m => textOf(m))
          .join('\n'),
      );
    },
  });
  return { result, seenByStep, model };
}

/** Runs every entry of one expectations plane: bare strings as passing tests,
 * tagged entries as `test.failing` (per-assertion knownBug, Task 4 Step 0);
 * `liveOnly` entries are the L3 layer's and are skipped here (Task 5b). */
function itEntries(
  suiteName: string,
  index: number,
  entries: ScenarioAssertion[] | undefined,
  actualOf: () => string,
): void {
  if (!entries || entries.length === 0) {
    return;
  }
  const deterministic = entries.filter(e => !assertionLiveOnly(e));
  describe(`${suiteName} — step ${index}`, () => {
    const passing = deterministic.filter(e => assertionKnownBug(e) === null);
    const failing = deterministic.filter((e): e is TaggedAssertion => assertionKnownBug(e) !== null);

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

describe.each([
  { label: 'implicit — "забыл дописать…"', scenarioDef: scenario },
  { label: 'explicit — "добавь к последней тренировке…"', scenarioDef: explicitScenario },
])('journey C — catch-up logging ($label)', ({ scenarioDef }) => {
  let result: ScenarioRunResult;
  /** Everything the model was handed, per user step (one string per step). */
  const seenByStep = new Map<number, string>();
  let model: ScriptedModelHandle;

  beforeAll(async () => {
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);
    const run = await runJourney(scenarioDef);
    result = run.result;
    model = run.model;
    run.seenByStep.forEach((seen, index) => seenByStep.set(index, seen));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  // `stepAt` reads the scenario itself, so it is safe at describe-definition
  // time; the observation accessors below touch `result`, which beforeAll
  // fills in before any test body runs.
  const userSteps = userStepsOf(scenarioDef);
  const stepAt = (index: number): UserStep => {
    const found = userSteps.find(s => s.index === index);
    if (!found) {
      throw new Error(`journey C: step ${index} must be a user step`);
    }
    return found.step;
  };

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
  const upperASessionOf = (index: number) => {
    const sessions = observationOf(index).sessions.filter(s => s.sessionKey === 'upper_a');
    const [current] = sessions;
    if (!current) {
      throw new Error(`journey C: no upper_a session in the step-${index} snapshot`);
    }
    return current;
  };

  /** The persisted-session projection the schema's `expect.persisted.session` describes. */
  const persistedProjection = (session: ReturnType<typeof upperASessionOf>) => ({
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
  });

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

  // --- step 9: the catch-up after +3.5 h — BUG-053: the stale session closes at this message,
  // chat answers it and adds the pull-ups to the finished workout (edit_last_workout) ---
  describe('step 9 — the catch-up message (after the +3.5 h pause)', () => {
    itEntries('delivered', 9, stepAt(9).expect?.delivered?.mustMatch, () => observationOf(9).delivered);

    it('the session is completed by the timeout auto-close (auto_close_reason = timeout)', () => {
      const raw = upperASessionOf(9);
      expect(raw.status).toBe('completed');
      expect(raw.autoCloseReason).toBe('timeout');
    });

    it('completed_at = the last pre-pause activity (set 2), not the catch-up clock — and edit_last_workout left it', () => {
      const raw = upperASessionOf(9);
      expect(raw.completedAt!.getTime()).toBe(raw.lastActivityAt!.getTime());
      expect(raw.completedAt!.getTime()).toBe(upperASessionOf(6).lastActivityAt!.getTime());
      // The trained window (set 2 at T0+12m), not the +3.7 h wall clock.
      expect(raw.completedAt!.getTime() - raw.startedAt!.getTime()).toBeGreaterThanOrEqual(11 * 60_000);
      expect(raw.completedAt!.getTime() - raw.startedAt!.getTime()).toBeLessThan(12.5 * 60_000);
    });

    it('edit_last_workout was called three times, log_set never', () => {
      const tools = observationOf(9).runRow?.toolCalls?.map(c => c.name) ?? [];
      expect(tools.filter(name => name === 'edit_last_workout')).toHaveLength(3);
      expect(tools).not.toContain('log_set');
    });

    it('the pull-up sets landed in the PREVIOUS session (same row — no new session opened, none left open)', () => {
      expect(observationOf(9).sessions.length).toBe(observationOf(6).sessions.length);
      expect(persistedProjection(upperASessionOf(9)).exercises).toEqual([
        {
          exercise: 'Barbell Bench Press',
          sets: [
            { reps: 8, weight: 80 },
            { reps: 8, weight: 80 },
          ],
        },
        { exercise: 'Pull-ups', sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
      ]);
      const open = observationOf(9).sessions.filter(s => s.status === 'in_progress' || s.status === 'planning');
      expect(open).toEqual([]);
    });

    it('the catch-up sets carry RETRO timestamps: last activity + 5 min, inside the pre-pause window', () => {
      const session = upperASessionOf(9);
      const pullUpSets = session.exercises.find(ex => ex.exercise.name === 'Pull-ups')?.sets ?? [];
      expect(pullUpSets).toHaveLength(3);
      for (const set of pullUpSets) {
        expect(set.createdAt.getTime() - session.lastActivityAt!.getTime()).toBe(RETRO_SET_OFFSET_MS);
      }
    });

    it('conversation_turns rows link to this run', async () => {
      expect(await turnCountOf(9)).toBeGreaterThan(0);
    });

    it('phase is chat (the message was answered there, the conversation did not move)', () => {
      expect(observationOf(9).phase).toBe('chat');
    });
  });

  it('consumed the whole script (no fallback answer leaked in)', () => {
    expect(model.chatScriptExhausted).toBe(true);
  });
});
