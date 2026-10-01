import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import { RETRO_SET_OFFSET_MS } from '@domain/training/session-timing';
import type { ITrainingService } from '@domain/training/ports';
import type { SessionSet, WorkoutSessionWithDetails } from '@domain/training/types';

import { renderTranscript } from '@infra/ai/graph/nodes/compact';
import { LLM_ERROR_PREFIX, SYSTEM_ERROR_PREFIX, toToolMessage } from '@infra/ai/tools/outcome';

import {
  makeExerciseWithDetails,
  makeSession,
  makeSessionSet,
} from '../../../../domain/training/services/__tests__/training-service-test-support';

import { makeDeps, makeTrainingService } from './log-set-test-support';

/** Renders a tool return exactly as the executor will (Task 5 contract). */
function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

// Flat input fields used in the new log_set schema (no nested setData object)
const FLAT_SET_INPUT = { reps: 10, weight: 80 };
// Expected setData built by the tool handler from flat fields
const EXPECTED_SET_DATA = { type: 'strength' as const, reps: 10, weight: 80, weightUnit: 'kg' as const };

describe('log-set.tool — log_set', () => {
  it('calls logSetWithContext with flat fields converted to setData object', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 2,
      rpe: 8,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: EXPECTED_SET_DATA,
    };
    trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke(
      {
        exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a',
        ...FLAT_SET_INPUT,
        rpe: 8,
      },
      config,
    )) as ToolReturn;

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a',
        exerciseName: undefined,
        setData: EXPECTED_SET_DATA,
        rpe: 8,
        feedback: undefined,
      }),
    );
    expect(renderedContent(result)).toContain('Set 2 logged');
    expect(renderedContent(result)).toContain('10 reps @ 80 kg');
  });

  it('load-plan Task 3 (A4): passes the optional advised object and the run context to logSetWithContext', async () => {
    const trainingService = makeTrainingService();
    const set: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 1,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: EXPECTED_SET_DATA,
    };
    trainingService.logSetWithContext.mockResolvedValue({ set, setNumber: 1 });
    const { byName, config } = makeDeps(trainingService);
    const now = new Date('2026-09-29T09:30:00Z');
    const advised = { load: 80, reps: 10, reason: 'fatigue after triceps' };
    await byName('log_set').invoke({ exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', ...FLAT_SET_INPUT, advised }, {
      ...config,
      context: { runId: 'run-1', now, user: { timezone: 'Asia/Manila' } },
    } as never);
    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ loadPlanLog: { runId: 'run-1', now, timezone: 'Asia/Manila', advised } }),
    );
  });

  it('returns SYSTEM_ERROR when no sessionId is set for the user', async () => {
    const trainingService = makeTrainingService();

    const { byName, config } = makeDeps(trainingService, null);
    const result = (await byName('log_set').invoke(
      {
        exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a',
        ...FLAT_SET_INPUT,
      },
      config,
    )) as ToolReturn;

    expect(renderedContent(result)).toContain(SYSTEM_ERROR_PREFIX);
    expect(trainingService.logSetWithContext).not.toHaveBeenCalled();
  });

  it('ignores order field — does not pass it to logSetWithContext', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 1,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: EXPECTED_SET_DATA,
    };
    trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 1 });

    const { byName, config } = makeDeps(trainingService);
    await byName('log_set').invoke(
      { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', ...FLAT_SET_INPUT, order: 2 },
      config,
    );

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a',
        exerciseName: undefined,
        setData: EXPECTED_SET_DATA,
        rpe: undefined,
        feedback: undefined,
      }),
    );
  });

  it('returns LLM_ERROR when logSetWithContext throws a non-DB error', async () => {
    const trainingService = makeTrainingService();
    trainingService.logSetWithContext.mockRejectedValue(new Error('Exercise not found'));

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke(
      {
        exerciseId: '00000000-0000-4000-8000-000000000063',
        ...FLAT_SET_INPUT,
      },
      config,
    )) as ToolReturn;

    expect(renderedContent(result)).toContain(LLM_ERROR_PREFIX);
    expect(renderedContent(result)).toContain('Exercise not found');
  });

  it('rounds a fractional rpe to the nearest 0.5 before persisting (BUG-035)', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 2,
      rpe: 9.5,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: EXPECTED_SET_DATA,
    };
    trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);
    await byName('log_set').invoke(
      { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', ...FLAT_SET_INPUT, rpe: 9.3 },
      config,
    );

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith('session-1', expect.objectContaining({ rpe: 9.5 }));
  });

  it('returns SYSTEM_ERROR, not LLM_ERROR, when the repository fails with a Postgres error (BUG-035 part 3)', async () => {
    const trainingService = makeTrainingService();
    trainingService.logSetWithContext.mockRejectedValue(
      Object.assign(new Error('invalid input syntax for type numeric: "9.55" in relation "session_sets"'), {
        code: '22P02',
      }),
    );

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke(
      { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', ...FLAT_SET_INPUT },
      config,
    )) as ToolReturn;
    const content = renderedContent(result);

    expect(content).toContain(SYSTEM_ERROR_PREFIX);
    expect(content).not.toContain(LLM_ERROR_PREFIX);
    expect(content).not.toMatch(/session_sets|invalid input syntax/i);
  });

  it('names the exercise in the confirmation, resolved from the post-write session snapshot (BUG-038 part 3)', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'se-1',
      setNumber: 2,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: { type: 'strength', reps: 12, weight: 55, weightUnit: 'kg' },
    };
    trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 2 });
    trainingService.getSessionDetails.mockResolvedValue({
      exercises: [{ id: 'se-1', exercise: { name: 'Lever Lat Pulldown (Plate-Loaded)' } }],
    } as unknown as Awaited<ReturnType<typeof trainingService.getSessionDetails>>);

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke(
      { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', reps: 12, weight: 55 },
      config,
    )) as ToolReturn;

    expect(renderedContent(result)).toBe('Set 2 logged — Lever Lat Pulldown (Plate-Loaded): 12 reps @ 55 kg.');
  });
});

describe('log-set.tool — isometric holds (AC-LPF-2)', () => {
  it('tells the model to log a plank / side plank hold as durationSeconds, never reps', () => {
    const { tools } = makeDeps(makeTrainingService());
    const { description } = tools[0] as unknown as { description: string };
    expect(description).toMatch(/isometric holds \(plank, side plank/);
    expect(description).toMatch(/durationSeconds.*SECONDS.*never reps/);
  });

  it('passes a hold as a duration set; the service re-keys it by the exercise type', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(null);
    trainingService.logSetWithContext.mockResolvedValue({
      set: makeSessionSet({ setNumber: 1 }),
      setNumber: 1,
    });
    const { tools, config } = makeDeps(trainingService);
    await tools[0].invoke({ exerciseName: 'Plank', durationSeconds: 45 }, config);
    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ exerciseName: 'Plank', setData: { type: 'cardio_duration', duration: 45 } }),
    );
  });
});

describe('log-set.tool — auto-complete notice (ADR-0011 Fix 1.3)', () => {
  it('should include auto-complete notice when exercise switches', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 1,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: EXPECTED_SET_DATA,
    };

    const mockResult = {
      set: mockSet,
      setNumber: 1,
      autoCompleted: {
        exerciseId: '00000000-0000-4000-8000-00000000000a',
        exerciseName: 'Lateral Raise',
        setsLogged: 2,
        sets: [
          { setNumber: 1, reps: 15, weight: 10, weightUnit: 'kg', rpe: null },
          { setNumber: 2, reps: 12, weight: 10, weightUnit: 'kg', rpe: 8 },
        ],
        targetSets: 3,
        targetReps: '12-15',
        targetWeight: null,
      },
    };
    trainingService.logSetWithContext.mockResolvedValue(mockResult);

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke(
      { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', ...FLAT_SET_INPUT },
      config,
    )) as ToolReturn;

    expect(renderedContent(result)).toContain('Lateral Raise');
    expect(renderedContent(result)).toContain('completed');
    expect(renderedContent(result)).toContain('Set 1');
    expect(renderedContent(result)).toContain('Set 2');
  });

  // Promoted from exercise-transition-order.repro.test.ts (session-investigation-0925 R4).
  it('BUG-037: a set-triggered switch confirms the reported set FIRST; the finished-exercise recap is brief, last, and announces nothing', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 1,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: EXPECTED_SET_DATA,
    };
    trainingService.logSetWithContext.mockResolvedValue({
      set: mockSet,
      setNumber: 1,
      autoCompleted: {
        exerciseId: '00000000-0000-4000-8000-00000000000a',
        exerciseName: 'Lateral Raise',
        setsLogged: 2,
        sets: [
          { setNumber: 1, reps: 15, weight: 10, weightUnit: 'kg', rpe: null },
          { setNumber: 2, reps: 12, weight: 10, weightUnit: 'kg', rpe: 8 },
        ],
        targetSets: 3,
        targetReps: '12-15',
        targetWeight: null,
      },
    });

    const { byName, config } = makeDeps(trainingService);
    const text = renderedContent(
      (await byName('log_set').invoke(
        { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', ...FLAT_SET_INPUT },
        config,
      )) as ToolReturn,
    );

    // The set the user just reported is the news: its confirmation comes first…
    expect(text.indexOf('Set 1 logged')).toBeGreaterThanOrEqual(0);
    // …the instruction tells the model to confirm that set before the recap…
    const confirmIdx = /(confirm|acknowledge|reply to|respond to)[^.\n]{0,140}\bset\b/i.exec(text)?.index ?? -1;
    const recapIdx = /recap[^.\n]{0,140}\b(finished|completed|previous|prior)\b/i.exec(text)?.index ?? -1;
    expect(confirmIdx).toBeGreaterThan(text.indexOf('Lateral Raise'));
    expect(recapIdx).toBeGreaterThan(confirmIdx);
    // …and never to announce an exercise the user already started.
    expect(text).not.toMatch(/announce[^.\n]{0,80}next exercise/i);
  });

  it('should NOT include auto-complete notice when no switch occurred', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 2,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: EXPECTED_SET_DATA,
    };
    trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke(
      { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', ...FLAT_SET_INPUT },
      config,
    )) as ToolReturn;

    expect(renderedContent(result)).not.toContain('auto-completed');
    expect(renderedContent(result)).toContain('Set 2 logged');
  });
});

// -------------------------------------------------------------------------
// ADR-0011 P3: Correction-triggered phantom sets (two-turn incident replay)
//
// Incident scenario (March 3, 2026):
//   Turn 1 — user says "that was my first set" (correction intent).
//            LLM misclassifies as new set → calls log_set → phantom created.
//   Turn 2 — user says "no, delete that" (correction intent).
//            LLM has NO delete tool → only option is log_set again → more phantoms.
// -------------------------------------------------------------------------

describe('log-set.tool — P3 incident replay — correction misclassified as new set', () => {
  it('(before fix) calling log_set twice produces two DB writes — no way to undo', async () => {
    // Simulate what happened: LLM called log_set on "first set" message
    // and again when user "corrected" — both succeed, both write to DB.
    // This test documents the current (broken) behavior — it passes today
    // and should remain green after fixes (the fix adds correction tools,
    // it does not prevent log_set from being called multiple times intentionally).
    const trainingService = makeTrainingService();
    const makeSet = (n: number): SessionSet => ({
      id: `set-${n}`,
      sessionExerciseId: 'ex-1',
      setNumber: n,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: EXPECTED_SET_DATA,
    });

    trainingService.logSetWithContext
      .mockResolvedValueOnce({ set: makeSet(1), setNumber: 1 })
      .mockResolvedValueOnce({ set: makeSet(2), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);

    // Turn 1: user says "that was my first set" → LLM calls log_set
    await byName('log_set').invoke({ exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', ...FLAT_SET_INPUT }, config);
    // Turn 2: user says "no no, remove last one" → LLM has no delete tool,
    //         calls log_set again trying to "correct" by re-logging
    await byName('log_set').invoke({ exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', ...FLAT_SET_INPUT }, config);

    // Both calls succeed — 2 DB writes for what should have been 1 set
    expect(trainingService.logSetWithContext).toHaveBeenCalledTimes(2);
  });
});

// -------------------------------------------------------------------------
// session-investigation-0925 R2 (BUG-038 part 3, AC-SI-5b): the summariser
// transcript must be able to name the exercise, not just its UUID.
// -------------------------------------------------------------------------

describe('log-set.tool — summariser input names the exercise (BUG-038 part 3)', () => {
  it('renderTranscript over the REAL log_set confirmation contains the exercise name, not just the UUID', async () => {
    const trainingService = makeTrainingService();
    const exerciseId = '11111111-1111-4111-8111-111111111111';
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'se-1',
      setNumber: 2,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: { type: 'strength', reps: 12, weight: 55, weightUnit: 'kg' },
    };
    trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 2 });
    trainingService.getSessionDetails.mockResolvedValue({
      exercises: [{ id: 'se-1', exercise: { name: 'Lever Lat Pulldown (Plate-Loaded)' } }],
    } as unknown as Awaited<ReturnType<typeof trainingService.getSessionDetails>>);

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke({ exerciseId, reps: 12, weight: 55 }, config)) as ToolReturn;
    const toolMessage = toToolMessage(isToolReturnWithUpdate(result) ? result.outcome : result, 'tc1');

    // The exact shape the graph appends: the tool call args carry exerciseId only (no
    // exerciseName — the model already had the UUID) and the REAL confirmation this tool
    // produced becomes the ToolMessage that renderTranscript sees at compaction time.
    const removed = [
      new HumanMessage({ id: 'h1', content: 'ещё подход' }),
      new AIMessage({
        id: 'a1',
        content: '',
        tool_calls: [{ id: 'tc1', name: 'log_set', args: { exerciseId, reps: 12, weight: 55 }, type: 'tool_call' }],
      }),
      toolMessage,
    ];

    const transcript = renderTranscript(removed);

    expect(transcript).toContain('Lever Lat Pulldown (Plate-Loaded)');
  });
});

// -------------------------------------------------------------------------
// set-kind plan Task 1 (D3, D5, AC-SK-1, AC-SK-4): setKind / weightBasis passthrough and the
// (warm-up) / per-hand confirmation markers. RED today: the schema rejects the unknown fields
// (or the zod default strips them silently) and the confirmation never renders the markers.
// -------------------------------------------------------------------------

describe('log-set.tool — setKind passthrough and confirmation marker (set-kind plan D3, AC-SK-1)', () => {
  it('passes setKind through to logSetWithContext when the user called it a warm-up', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 1,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: { type: 'strength', reps: 10, weight: 40, weightUnit: 'kg' },
      setKind: 'warmup',
    };
    trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 1 });

    const { byName, config } = makeDeps(trainingService);
    await byName('log_set').invoke(
      { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', reps: 10, weight: 40, setKind: 'warmup' },
      config,
    );

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ setKind: 'warmup' }),
    );
  });

  it('the confirmation names a warm-up set "(warm-up)" when the saved set came back with setKind warmup', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 1,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: { type: 'strength', reps: 10, weight: 40, weightUnit: 'kg' },
      setKind: 'warmup',
    };
    trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 1 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke(
      { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', reps: 10, weight: 40, setKind: 'warmup' },
      config,
    )) as ToolReturn;

    expect(renderedContent(result)).toBe('Set 1 logged: 10 reps @ 40 kg (warm-up).');
  });

  it('a working set (no setKind passed) never shows the warm-up marker', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 3,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: { type: 'strength', reps: 10, weight: 60, weightUnit: 'kg' },
      setKind: 'working',
    };
    trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 3 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke(
      { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', reps: 10, weight: 60 },
      config,
    )) as ToolReturn;

    expect(renderedContent(result)).not.toContain('warm-up');
  });
});

describe('log-set.tool — weightBasis passthrough and per-hand confirmation marker (set-kind plan D5, AC-SK-4)', () => {
  it('passes weightBasis through to logSetWithContext when the user said the weight is a total', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 1,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: { type: 'strength', reps: 10, weight: 24, weightUnit: 'kg', perHand: false },
      setKind: 'working',
    };
    trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 1 });

    const { byName, config } = makeDeps(trainingService);
    await byName('log_set').invoke(
      { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', reps: 10, weight: 24, weightBasis: 'total' },
      config,
    );

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ weightBasis: 'total' }),
    );
  });

  it('the confirmation says "per hand" when the saved set came back with setData.perHand true', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 1,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: { type: 'strength', reps: 10, weight: 12, weightUnit: 'kg', perHand: true },
      setKind: 'working',
    };
    trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 1 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke(
      { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', reps: 10, weight: 12 },
      config,
    )) as ToolReturn;

    expect(renderedContent(result)).toBe('Set 1 logged: 10 reps @ 12 kg per hand.');
  });

  it('a barbell set (no perHand on the returned setData) never shows "per hand"', async () => {
    const trainingService = makeTrainingService();
    const mockSet: SessionSet = {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 1,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: { type: 'strength', reps: 8, weight: 80, weightUnit: 'kg' },
      setKind: 'working',
    };
    trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 1 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke(
      { exerciseId: 'd8794819-ffc6-4d08-8336-d9bedc4e554a', reps: 8, weight: 80 },
      config,
    )) as ToolReturn;

    expect(renderedContent(result)).not.toContain('per hand');
  });
});

const HOUR = 60 * 60 * 1000;
const BENCH_ID = 'd8794819-ffc6-4d08-8336-d9bedc4e554a';

/** A session whose last activity is `idleMs` ago; `withSets` puts one logged set in it. */
function idleSession(idleMs: number, withSets: boolean): WorkoutSessionWithDetails {
  const lastActivityAt = new Date(Date.now() - idleMs);
  const sets = withSets ? [makeSessionSet({ createdAt: lastActivityAt })] : [];
  return {
    ...makeSession([makeExerciseWithDetails({ id: 'se-1', status: 'in_progress', sets })]),
    startedAt: new Date(lastActivityAt.getTime() - 60_000),
    lastActivityAt,
    createdAt: new Date(lastActivityAt.getTime() - 60_000),
    updatedAt: lastActivityAt,
  };
}

function mockLoggedSet(service: jest.Mocked<ITrainingService>, setNumber: number): void {
  const set: SessionSet = makeSessionSet({ setNumber });
  service.logSetWithContext.mockResolvedValue({ set, setNumber });
}

describe('log-set.tool — retro vs live timing (BUG-043, AC-RT-1, AC-RT-4)', () => {
  it('AC-RT-1a/1b/4: a session with NO sets idle > 2 h — the first and the second set are live, never "(retro-logged)"', async () => {
    const service = makeTrainingService();
    service.getSessionDetails.mockResolvedValue(idleSession(3 * HOUR, false));
    const { byName, config } = makeDeps(service);

    for (const setNumber of [1, 2]) {
      mockLoggedSet(service, setNumber);
      const result = (await byName('log_set').invoke(
        { exerciseId: BENCH_ID, reps: 10, weight: 80 },
        config,
      )) as ToolReturn;

      const { calls } = service.logSetWithContext.mock;
      const [, opts] = calls[calls.length - 1]!;
      expect(opts.createdAt).toBeUndefined();
      expect(opts.skipActivityUpdate).not.toBe(true);
      expect(renderedContent(result)).not.toContain('retro-logged');
    }
  });

  it('AC-RT-1c (control, green on unchanged production): a session WITH sets idle > 2 h — the catch-up set stays retro', async () => {
    const service = makeTrainingService();
    const session = idleSession(3 * HOUR, true);
    service.getSessionDetails.mockResolvedValue(session);
    mockLoggedSet(service, 2);
    const { byName, config } = makeDeps(service);

    const result = (await byName('log_set').invoke(
      { exerciseId: BENCH_ID, reps: 10, weight: 80 },
      config,
    )) as ToolReturn;

    const [, opts] = service.logSetWithContext.mock.calls[0]!;
    expect(opts.skipActivityUpdate).toBe(true);
    expect(opts.createdAt?.getTime()).toBe(session.lastActivityAt.getTime() + RETRO_SET_OFFSET_MS);
    expect(renderedContent(result)).toContain('(retro-logged)');
  });
});
