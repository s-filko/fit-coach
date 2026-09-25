import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { SessionSet } from '@domain/training/types';

import { renderTranscript } from '@infra/ai/graph/nodes/compact';
import { LLM_ERROR_PREFIX, SYSTEM_ERROR_PREFIX, toToolMessage } from '@infra/ai/tools/outcome';

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
