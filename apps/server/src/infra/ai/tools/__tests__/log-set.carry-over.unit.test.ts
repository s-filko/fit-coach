import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { SessionSet } from '@domain/training/types';

import { toToolMessage } from '@infra/ai/tools/outcome';

import { makeDeps, makeTrainingService } from './log-set-test-support';

// D15: reps reported without a weight on an exercise already weighted in this session
// ("did another 12") must not turn into a bodyweight functional_reps set.

const EX_ID = 'd8794819-ffc6-4d08-8336-d9bedc4e554a';

function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

type PriorSet = SessionSet['setData'] | { setData: SessionSet['setData']; setKind: 'warmup' | 'working' };

const sessionWith = (sets: PriorSet[]) =>
  ({
    id: 'session-1',
    lastActivityAt: new Date(),
    exercises: [
      {
        id: 'se-1',
        exerciseId: EX_ID,
        exercise: { name: 'Pec Deck' },
        sets: sets.map((s, i) =>
          'setKind' in s
            ? { id: `s${i}`, setNumber: i + 1, setData: s.setData, setKind: s.setKind }
            : { id: `s${i}`, setNumber: i + 1, setData: s },
        ),
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

describe('log-set.tool — weight carried over from the previous set', () => {
  it('stores a strength set with the latest weight when reps come without weight', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(
      sessionWith([
        { type: 'strength', reps: 12, weight: 45, weightUnit: 'kg' },
        { type: 'strength', reps: 12, weight: 59, weightUnit: 'kg' },
      ]),
    );
    const expected = { type: 'strength' as const, reps: 12, weight: 59, weightUnit: 'kg' as const };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 3 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke({ exerciseId: EX_ID, reps: 12 }, config)) as ToolReturn;

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ setData: expected }),
    );
    expect(renderedContent(result)).toContain('12 reps @ 59 kg');
    expect(renderedContent(result)).toContain('Weight 59 kg carried over from set 2');
  });

  it('keeps functional_reps when no earlier set of the exercise had a weight', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(sessionWith([{ type: 'functional_reps', reps: 8 }]));
    const expected = { type: 'functional_reps' as const, reps: 8 };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke({ exerciseId: EX_ID, reps: 8 }, config)) as ToolReturn;

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ setData: expected }),
    );
    expect(renderedContent(result)).not.toContain('carried over');
  });

  it('matches the exercise by name when no id is given', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(
      sessionWith([{ type: 'strength', reps: 12, weight: 59, weightUnit: 'kg' }]),
    );
    const expected = { type: 'strength' as const, reps: 10, weight: 59, weightUnit: 'kg' as const };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);
    await byName('log_set').invoke({ exerciseName: 'pec deck', reps: 10 }, config);

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ setData: expected }),
    );
  });

  it('never carries a warm-up weight into a working set', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(
      sessionWith([
        { setData: { type: 'strength', reps: 8, weight: 65, weightUnit: 'kg' }, setKind: 'working' },
        { setData: { type: 'strength', reps: 7, weight: 40, weightUnit: 'kg' }, setKind: 'warmup' },
      ]),
    );
    const expected = { type: 'strength' as const, reps: 6, weight: 65, weightUnit: 'kg' as const };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 3 });

    const { byName, config } = makeDeps(trainingService);
    await byName('log_set').invoke({ exerciseId: EX_ID, reps: 6 }, config);

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ setData: expected }),
    );
  });

  // AC-PTF-3 (plan-and-tool-fixes T3): the session exercise is matched by the id the
  // service resolves from an inexact name — "bench press" must carry from
  // "Barbell Bench Press", not fall through to a bodyweight set.
  it('carries the weight when the exercise is named inexactly (resolver resolves it)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(
      sessionWith([{ type: 'strength', reps: 8, weight: 60, weightUnit: 'kg' }]),
    );
    trainingService.resolveExerciseIdByName.mockResolvedValue(EX_ID);
    const expected = { type: 'strength' as const, reps: 10, weight: 60, weightUnit: 'kg' as const };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke({ exerciseName: 'bench press', reps: 10 }, config)) as ToolReturn;

    expect(trainingService.resolveExerciseIdByName).toHaveBeenCalledTimes(1);
    expect(trainingService.resolveExerciseIdByName).toHaveBeenCalledWith('bench press');
    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ exerciseId: EX_ID, setData: expected }),
    );
    expect(renderedContent(result)).toContain('Weight 60 kg carried over from set 1');
  });

  it('falls back to today’s name-only path when the resolver throws (no carry, name passed on)', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(
      sessionWith([{ type: 'strength', reps: 8, weight: 60, weightUnit: 'kg' }]),
    );
    trainingService.resolveExerciseIdByName.mockRejectedValue(new Error('not found'));
    const expected = { type: 'functional_reps' as const, reps: 10 };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);
    const result = (await byName('log_set').invoke({ exerciseName: 'bench press', reps: 10 }, config)) as ToolReturn;

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ exerciseName: 'bench press', setData: expected }),
    );
    expect(trainingService.logSetWithContext.mock.calls[0][1].exerciseId).toBeUndefined();
    expect(renderedContent(result)).not.toContain('carried over');
  });

  // AC-PTF-4 (plan-and-tool-fixes T4): an explicit weight of 0 means a bodyweight set —
  // after a weighted pull-up, weight 0 must not store "@ 0 kg" and must not carry.
  it('log_set with weight 0 stores functional_reps, no carry, no "@ 0 kg"', async () => {
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
    expect(renderedContent(result)).toContain('8 reps');
    expect(renderedContent(result)).not.toContain('@ 0 kg');
    expect(renderedContent(result)).not.toContain('carried over');
  });

  it('keeps a total-weight basis when the carried set was logged as a total', async () => {
    const trainingService = makeTrainingService();
    trainingService.getSessionDetails.mockResolvedValue(
      sessionWith([{ type: 'strength', reps: 10, weight: 20, weightUnit: 'kg', perHand: false }]),
    );
    const expected = { type: 'strength' as const, reps: 10, weight: 20, weightUnit: 'kg' as const };
    trainingService.logSetWithContext.mockResolvedValue({ set: savedSet(expected), setNumber: 2 });

    const { byName, config } = makeDeps(trainingService);
    await byName('log_set').invoke({ exerciseId: EX_ID, reps: 10 }, config);

    expect(trainingService.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ setData: expected, weightBasis: 'total' }),
    );
  });
});
