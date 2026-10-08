import { toJsonSchema } from '@langchain/core/utils/json_schema';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';
import type { Exercise, SessionSet, WeightMode } from '@domain/training/types';

import { LLM_ERROR_PREFIX, toToolMessage } from '@infra/ai/tools/outcome';

import { buildLogSetTool } from '../log-set.tool';
import { makeDeps, makeExerciseRepository, makeTrainingService } from './log-set-test-support';

// T5/T6/T7 (plan-and-tool-fixes): the model sets the weight; the code never derives one.
// T7 refines T6's blanket "weight required with reps" into the per-exercise weight_mode:
// `required` + reps without a weight → llmError naming the exercise; `optional` (bodyweight
// equipment) + reps without a weight → a bodyweight set, a number → added load; `none` never
// stores a weight. An explicit weight of 0 still means a bodyweight set on any mode (T4).
// No algorithmic carry-over (T5): the tool stores what the model passes.

const EX_ID = 'd8794819-ffc6-4d08-8336-d9bedc4e554a';
const PULL_UPS_ID = '8c88ebce-f5df-4d33-afdb-0b096a0dd7a8';
const RUNNING_ID = 'da89020e-f54a-4573-b70b-764833ae761a';

/** A catalog row of the given mode, in the equipment/category shape that derives it. */
const catalogExercise = (id: string, name: string, weightMode: WeightMode): Exercise => {
  const cardio = weightMode === 'none';
  const equipment: Exercise['equipment'] = cardio ? 'none' : 'barbell';
  return {
    id,
    name,
    category: cardio ? 'cardio' : 'compound',
    equipment: weightMode === 'optional' ? 'bodyweight' : equipment,
    exerciseType: cardio ? 'cardio_distance' : 'strength',
    description: null,
    energyCost: 'high',
    complexity: 'intermediate',
    typicalDurationMinutes: 10,
    requiresSpotter: false,
    imageUrl: null,
    videoUrl: null,
    createdAt: new Date(),
    weightMode,
  };
};

const BENCH_REQUIRED = catalogExercise(EX_ID, 'Barbell Bench Press', 'required');
const PULL_UPS_OPTIONAL = catalogExercise(PULL_UPS_ID, 'Pull-ups', 'optional');
const RUNNING_NONE = catalogExercise(RUNNING_ID, 'Running', 'none');

function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

const sessionWith = (sets: SessionSet['setData'][]) =>
  ({
    id: 'session-1',
    lastActivityAt: new Date(),
    exercises: [
      {
        id: 'se-1',
        exerciseId: EX_ID,
        exercise: { name: 'Barbell Bench Press' },
        sets: sets.map((s, i) => ({ id: `s${i}`, setNumber: i + 1, setData: s })),
      },
    ],
  }) as never;

const savedSet = (setData: SessionSet['setData']): SessionSet => ({
  id: 'set-9',
  sessionExerciseId: 'se-1',
  setNumber: 3,
  rpe: null,
  userFeedback: null,
  createdAt: new Date(),
  completedAt: null,
  setData,
});

describe('log-set.tool — the weight requirement is per exercise (AC-PTF-7)', () => {
  it('weight_mode required + reps without a weight → LLM_ERROR naming the exercise, nothing stored (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));

    const { byName, config } = makeDeps(trainingService, makeExerciseRepository(BENCH_REQUIRED));
    const result = (await byName('log_set').invoke({ exerciseId: EX_ID, reps: 12 }, config)) as ToolReturn;
    const content = renderedContent(result);

    expect(content).toContain(LLM_ERROR_PREFIX);
    expect(content).toContain('Barbell Bench Press: weight is required');
    expect(trainingService.logSetWithContext).not.toHaveBeenCalled();
  });

  // The inversion of T6's blanket schema refine: on a bodyweight exercise reps without a
  // weight are a valid bodyweight set again (BR-TRAINING-040's isometric case included).
  it('weight_mode optional + reps without a weight → a bodyweight set (functional_reps) (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));
    const expected = { type: 'functional_reps' as const, reps: 8 };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService, makeExerciseRepository(PULL_UPS_OPTIONAL));
    const result = (await byName('log_set').invoke({ exerciseId: PULL_UPS_ID, reps: 8 }, config)) as ToolReturn;

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ exerciseId: PULL_UPS_ID, setData: expected }),
    );
    expect(renderedContent(result)).toContain('8 reps @ bodyweight');
  });

  it('weight_mode optional + a number → added load (strength) (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));
    const expected = { type: 'strength' as const, reps: 8, weight: 10, weightUnit: 'kg' as const };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService, makeExerciseRepository(PULL_UPS_OPTIONAL));
    await byName('log_set').invoke({ exerciseId: PULL_UPS_ID, reps: 8, weight: 10 }, config);

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ setData: expected }),
    );
  });

  it('weight_mode none never stores a weight — cardio stays duration/distance (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));
    trainingService.logSetWithContext.mockResolvedValue({
      set: savedSet({ type: 'cardio_duration', duration: 1800 }),
      setNumber: 1,
    });

    const { byName, config } = makeDeps(trainingService, makeExerciseRepository(RUNNING_NONE));
    const result = (await byName('log_set').invoke(
      { exerciseId: RUNNING_ID, durationSeconds: 1800, weight: 5 },
      config,
    )) as ToolReturn;

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ setData: { type: 'cardio_duration', duration: 1800 } }),
    );
    expect(renderedContent(result)).not.toContain('5 kg');
  });

  it('weight_mode none drops a weight from a reps call too — the set is stored without one (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));
    const expected = { type: 'functional_reps' as const, reps: 20 };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 1 });

    const { byName, config } = makeDeps(trainingService, makeExerciseRepository(RUNNING_NONE));
    await byName('log_set').invoke({ exerciseId: RUNNING_ID, reps: 20, weight: 5 }, config);

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ setData: expected }),
    );
  });

  // AC-PTF-4 kept verbatim through T7: an explicit weight of 0 means a bodyweight set on any mode.
  it('log_set with weight 0 stores functional_reps, no carry, named "bodyweight" (AC-PTF-4, AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(
      sessionWith([{ type: 'strength', reps: 8, weight: 10, weightUnit: 'kg' }]),
    );
    const expected = { type: 'functional_reps' as const, reps: 8 };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService, makeExerciseRepository(BENCH_REQUIRED));
    const result = (await byName('log_set').invoke({ exerciseId: EX_ID, reps: 8, weight: 0 }, config)) as ToolReturn;

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ setData: expected }),
    );
    expect(renderedContent(result)).toContain('8 reps @ bodyweight');
    expect(renderedContent(result)).not.toContain('@ 0 kg');
    expect(renderedContent(result)).not.toContain('carried over');
  });

  it('log_set with weight 0 and no reps/duration/distance is rejected by the schema, nothing stored (AC-PTF-4)', async () => {
    const trainingService = makeTrainingService();
    const { byName, config } = makeDeps(trainingService, makeExerciseRepository(BENCH_REQUIRED));

    await expect(byName('log_set').invoke({ exerciseId: EX_ID, weight: 0 }, config)).rejects.toThrow(
      /Either reps, durationSeconds, or distanceKm must be provided/,
    );
    expect(trainingService.logSetWithContext).not.toHaveBeenCalled();
  });

  // T7 narrows T5's rule: the tool resolves the exercise once to read its weight_mode and
  // passes the resolved id along, so the service does not resolve the name a second time.
  it('a name-only call resolves once and logs by the resolved id (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));
    trainingService.resolveExerciseIdByName.mockResolvedValue(PULL_UPS_ID);
    trainingService.logSetWithContext.mockResolvedValue({
      set: savedSet({ type: 'functional_reps', reps: 8 }),
      setNumber: 2,
    });

    const { byName, config } = makeDeps(trainingService, makeExerciseRepository(PULL_UPS_OPTIONAL));
    await byName('log_set').invoke({ exerciseName: 'pull-ups', reps: 8 }, config);

    expect(trainingService.resolveExerciseIdByName).toHaveBeenCalledTimes(1);
    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ exerciseId: PULL_UPS_ID, setData: { type: 'functional_reps', reps: 8 } }),
    );
    expect(trainingService.logSetWithContext.mock.calls[0][1].exerciseName).toBeUndefined();
  });

  it('an exercise the catalog cannot resolve keeps the pre-T7 path — no rejection, the service reports it (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));
    // The tool's own lookup fails (name unresolvable) — the service then reports the same
    // error on the unchanged pass-through path.
    trainingService.resolveExerciseIdByName.mockRejectedValue(new Error('no exercise found for name "plankk"'));
    trainingService.logSetWithContext.mockRejectedValue(new Error('no exercise found for name "plankk"'));
    const repo = makeExerciseRepository(null);

    const { byName, config } = makeDeps(trainingService, repo);
    const result = (await byName('log_set').invoke({ exerciseName: 'plankk', reps: 8 }, config)) as ToolReturn;

    // No per-mode rejection fired (the mode is unknown); the name error reaches the model as before.
    expect(renderedContent(result)).not.toContain('weight is required');
    expect(renderedContent(result)).toContain('no exercise found for name "plankk"');
  });
});

// T7 "Tool texts": the declared contract states the per-exercise weight rule — facts only.
describe('log-set.tool — the declared contract states the per-exercise weight rule', () => {
  it('the bodyweight line and the weight describe state the three modes (AC-PTF-7)', () => {
    const built = buildLogSetTool({
      trainingService: makeTrainingService(),
      exerciseRepository: makeExerciseRepository(),
    }) as unknown as {
      description: string;
      schema: Parameters<typeof toJsonSchema>[0];
    };

    expect(built.description).toContain(
      'For bodyweight exercises: provide reps and optionally a weight — omitted = a bodyweight set, a number = added load.',
    );
    expect(built.description).not.toContain('provide reps and weight 0 (no external load).');

    const jsonSchema = toJsonSchema(built.schema) as unknown as {
      properties: Record<string, { description?: string }>;
    };
    expect(jsonSchema.properties.weight?.description).toBe(
      'Weight in kilograms (kg). Required for exercises that use a weight; optional for bodyweight exercises (omitted = bodyweight, a number = added load); not used for cardio.',
    );
  });
});
