import { toJsonSchema } from '@langchain/core/utils/json_schema';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import { WeightRequiredError } from '@domain/training/errors';
import type { SessionSet } from '@domain/training/types';

import { LLM_ERROR_PREFIX, toToolMessage } from '@infra/ai/tools/outcome';

import { buildLogSetTool } from '../log-set.tool';
import { makeDeps, makeTrainingService } from './log-set-test-support';

// T5/T6/T7 (plan-and-tool-fixes): the model sets the weight; the code never derives one.
// The weight requirement per exercise (AC-PTF-7) is judged by TrainingService on the catalog row
// it already resolves (training-service-weight-mode.unit.test.ts, review pass 5) — this tool
// builds setData from what the model passed, tells the service whether a weight was omitted,
// and relays the service's WeightRequiredError as llm_error. No algorithmic carry-over (T5).

const EX_ID = 'd8794819-ffc6-4d08-8336-d9bedc4e554a';
const PULL_UPS_ID = '8c88ebce-f5df-4d33-afdb-0b096a0dd7a8';
const RUNNING_ID = 'da89020e-f54a-4573-b70b-764833ae761a';

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

describe("log-set.tool — the weight requirement is the service's, the tool relays it (AC-PTF-7)", () => {
  it('a WeightRequiredError from the service → LLM_ERROR naming the exercise (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));
    trainingService.logSetWithContext.mockRejectedValue(new WeightRequiredError('Barbell Bench Press'));

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke({ exerciseId: EX_ID, reps: 12 }, config)) as ToolReturn;
    const content = renderedContent(result);

    expect(content).toContain(LLM_ERROR_PREFIX);
    expect(content).toContain('Barbell Bench Press: weight is required');
  });

  it('reps without a weight reach the service as a bodyweight set flagged weightOmitted (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));
    const expected = { type: 'functional_reps' as const, reps: 8 };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke({ exerciseId: PULL_UPS_ID, reps: 8 }, config)) as ToolReturn;

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ exerciseId: PULL_UPS_ID, setData: expected, weightOmitted: true }),
    );
    expect(renderedContent(result)).toContain('8 reps @ bodyweight');
  });

  it('reps with a number reach the service as added load, weightOmitted false (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));
    const expected = { type: 'strength' as const, reps: 8, weight: 10, weightUnit: 'kg' as const };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);
    await byName('log_set').invoke({ exerciseId: PULL_UPS_ID, reps: 8, weight: 10 }, config);

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ setData: expected, weightOmitted: false }),
    );
  });

  it('a duration call carries no weight in setData — cardio stays duration/distance (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));
    trainingService.logSetWithContext.mockResolvedValue({
      set: savedSet({ type: 'cardio_duration', duration: 1800 }),
      setNumber: 1,
    });

    const { byName, config } = makeDeps(trainingService);
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

  // AC-PTF-4 kept verbatim through T7: an explicit weight of 0 means a bodyweight set on any mode.
  it('log_set with weight 0 stores functional_reps, no carry, named "bodyweight" (AC-PTF-4, AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(
      sessionWith([{ type: 'strength', reps: 8, weight: 10, weightUnit: 'kg' }]),
    );
    const expected = { type: 'functional_reps' as const, reps: 8 };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke({ exerciseId: EX_ID, reps: 8, weight: 0 }, config)) as ToolReturn;

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ setData: expected, weightOmitted: false }),
    );
    expect(renderedContent(result)).toContain('8 reps @ bodyweight');
    expect(renderedContent(result)).not.toContain('@ 0 kg');
    expect(renderedContent(result)).not.toContain('carried over');
  });

  it('log_set with weight 0 and no reps/duration/distance is rejected by the schema, nothing stored (AC-PTF-4)', async () => {
    const trainingService = makeTrainingService();
    const { byName, config } = makeDeps(trainingService);

    await expect(byName('log_set').invoke({ exerciseId: EX_ID, weight: 0 }, config)).rejects.toThrow(
      /Either reps, durationSeconds, or distanceKm must be provided/,
    );
    expect(trainingService.logSetWithContext).not.toHaveBeenCalled();
  });

  // The tool does not read the catalog: a name goes to the service as given, and the service
  // resolves it once (ensureCurrentExercise) and judges the weight on that row.
  it('a name-only call passes the name through and resolves nothing itself (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));
    trainingService.logSetWithContext.mockResolvedValue({
      set: savedSet({ type: 'functional_reps', reps: 8 }),
      setNumber: 2,
    });

    const { byName, config } = makeDeps(trainingService);
    await byName('log_set').invoke({ exerciseName: 'pull-ups', reps: 8 }, config);

    expect(trainingService.resolveExerciseIdByName).not.toHaveBeenCalled();
    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ exerciseName: 'pull-ups', setData: { type: 'functional_reps', reps: 8 } }),
    );
    expect(trainingService.logSetWithContext.mock.calls[0][1].exerciseId).toBeUndefined();
  });

  it('a service failure on an unresolvable name reaches the model as before (AC-PTF-7)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([]));
    trainingService.logSetWithContext.mockRejectedValue(new Error('no exercise found for name "plankk"'));

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke({ exerciseName: 'plankk', reps: 8 }, config)) as ToolReturn;

    expect(renderedContent(result)).not.toContain('weight is required');
    expect(renderedContent(result)).toContain('no exercise found for name "plankk"');
  });
});

// T7 "Tool texts": the declared contract states the per-exercise weight rule — facts only.
describe('log-set.tool — the declared contract states the per-exercise weight rule', () => {
  it('the bodyweight line and the weight describe state the three modes (AC-PTF-7)', () => {
    const built = buildLogSetTool({ trainingService: makeTrainingService() }) as unknown as {
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
