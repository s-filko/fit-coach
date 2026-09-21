/**
 * REPRODUCTION (RED) — AC-LSR-1 / BUG-023. Runs only via an explicit --testMatch; promoted to
 * log-set.tool.unit.test.ts when the fix lands.
 *
 * The log_set description documents exactly three set shapes: strength (reps + weight),
 * bodyweight ("reps only") and cardio duration ("durationSeconds", for bike/elliptical). A timed
 * hold — a 45-second plank — has no documented shape, so a model following the description sends
 * the seconds as `reps`, and the tool stores "45 reps". Live evidence: session fa293e20, 2026-09-21
 * (Plank 45 / Side Plank 30 stored as functional_reps).
 */
import type { RunnableConfig } from '@langchain/core/runnables';

import type { ITrainingService } from '@domain/training/ports';
import type { SessionSet } from '@domain/training/types';

import { buildLogSetTool } from '../log-set.tool';

type InvokableTool = {
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

const config: RunnableConfig = {
  configurable: { userId: 'u1', thread_id: 'u1', activeSessionId: 'session-1' },
};

/** Echoes the setData it is given back as the stored set, so the test reads what the tool decided. */
function makeTool() {
  const logSetWithContext = jest.fn().mockImplementation(async (_sessionId: string, input: { setData: unknown }) => ({
    set: {
      id: 'set-1',
      sessionExerciseId: 'ex-1',
      setNumber: 1,
      rpe: null,
      userFeedback: null,
      createdAt: new Date(),
      completedAt: null,
      setData: input.setData,
    } as SessionSet,
    setNumber: 1,
  }));
  const trainingService = {
    getSessionDetails: jest.fn().mockResolvedValue(null),
    logSetWithContext,
  } as unknown as ITrainingService;
  const tool = buildLogSetTool({ trainingService }) as unknown as InvokableTool;
  const storedSetData = (): Record<string, unknown> => logSetWithContext.mock.calls[0][1].setData;
  return { tool, storedSetData };
}

describe('log_set — timed isometric hold (BUG-023)', () => {
  it('control: a cardio duration is stored as a duration', async () => {
    const { tool, storedSetData } = makeTool();

    await tool.invoke({ exerciseName: 'Stationary Bike', durationSeconds: 1200 }, config);

    expect(storedSetData()).toMatchObject({ type: 'cardio_duration', duration: 1200 });
  });

  it('stores a 45-second plank, logged the documented bodyweight way, as a duration and not as reps', async () => {
    const { tool, storedSetData } = makeTool();

    // "For bodyweight exercises: provide reps only." — the only documented path for a plank.
    await tool.invoke({ exerciseName: 'Plank', reps: 45 }, config);

    expect(storedSetData()).toMatchObject({ duration: 45 });
    expect(storedSetData()).not.toMatchObject({ type: 'functional_reps' });
  });
});
