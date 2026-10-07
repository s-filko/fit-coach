import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { SessionSet } from '@domain/training/types';

import { toToolMessage } from '@infra/ai/tools/outcome';

import { makeDeps, makeTrainingService } from './log-set-test-support';

// T5/T6 (plan-and-tool-fixes): the model sets the weight — the tool stores what it is given.
// With reps the weight is required (0 = a bodyweight set, stored as functional_reps); a call
// with reps and no weight is rejected by the schema, so nothing is ever stored with a weight
// the model did not pass (BR-TRAINING-047). No algorithmic carry-over from earlier sets; an
// exerciseName is resolved by the service, not the tool.

const EX_ID = 'd8794819-ffc6-4d08-8336-d9bedc4e554a';

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

describe('log-set.tool — the model sets the weight, no algorithmic carry-over', () => {
  // AC-PTF-6 (plan-and-tool-fixes T6, superseding the T5 shape): the weight has no default —
  // with reps the model must pass it (0 = a bodyweight set). A reps-only call never reaches
  // the handler: the schema rejects it, nothing is stored.
  it('rejects reps without a weight at the schema level, nothing stored (AC-PTF-6)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(
      sessionWith([
        { type: 'strength', reps: 12, weight: 45, weightUnit: 'kg' },
        { type: 'strength', reps: 12, weight: 59, weightUnit: 'kg' },
      ]),
    );

    const { byName, config } = makeDeps(trainingService);
    await expect(byName('log_set').invoke({ exerciseId: EX_ID, reps: 12 }, config)).rejects.toThrow(
      /weight is required with reps/,
    );
    expect(trainingService.logSetWithContext).not.toHaveBeenCalled();
  });

  // AC-PTF-5 (plan-and-tool-fixes T5, reverting T3): the name pre-resolution existed only to
  // find the set to carry from — the service resolves the name once, the tool never does.
  it('passes exerciseName through unresolved, resolver never called by the tool (AC-PTF-5)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(
      sessionWith([{ type: 'strength', reps: 8, weight: 60, weightUnit: 'kg' }]),
    );
    trainingService.resolveExerciseIdByName.mockResolvedValue(EX_ID);
    const expected = { type: 'strength' as const, reps: 10, weight: 60, weightUnit: 'kg' as const };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke(
      { exerciseName: 'bench press', reps: 10, weight: 60 },
      config,
    )) as ToolReturn;

    expect(trainingService.resolveExerciseIdByName).not.toHaveBeenCalled();
    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ exerciseName: 'bench press', setData: expected }),
    );
    expect(trainingService.logSetWithContext.mock.calls[0][1].exerciseId).toBeUndefined();
    expect(renderedContent(result)).not.toContain('carried over');
  });

  // AC-PTF-4 (plan-and-tool-fixes T4): an explicit weight of 0 means a bodyweight set —
  // after a weighted pull-up, weight 0 must not store "@ 0 kg" and must not carry.
  it('log_set with weight 0 and no reps/duration/distance is rejected by the schema, nothing stored (AC-PTF-4)', async () => {
    const trainingService = makeTrainingService();
    const { byName, config } = makeDeps(trainingService);

    await expect(byName('log_set').invoke({ exerciseId: EX_ID, weight: 0 }, config)).rejects.toThrow(
      /Either reps, durationSeconds, or distanceKm must be provided/,
    );
    expect(trainingService.logSetWithContext).not.toHaveBeenCalled();
  });

  it('log_set with weight 0 stores functional_reps, no carry, named "bodyweight" (AC-PTF-4, AC-PTF-6)', async () => {
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
      expect.objectContaining({ setData: expected }),
    );
    expect(renderedContent(result)).toContain('8 reps @ bodyweight');
    expect(renderedContent(result)).not.toContain('@ 0 kg');
    expect(renderedContent(result)).not.toContain('carried over');
  });
});
