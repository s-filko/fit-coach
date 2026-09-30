/**
 * retro-timestamps plan, T2 (BUG-043) — AC-RT-1, AC-RT-2, AC-RT-4 at tool level.
 * Home tests at promotion (T3): `log-set.tool.unit.test.ts`, `finish-training.tool.unit.test.ts`.
 *
 * Mocked service (log-set-test-support.ts): the tool decides retro-vs-live from the session it reads
 * through `getSessionDetails`; what it hands to `logSetWithContext` / `completeSession` is the effect.
 */
import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';
import type { SessionSet, WorkoutSessionWithDetails } from '@domain/training/types';

import { toToolMessage } from '@infra/ai/tools/outcome';

import {
  makeExerciseWithDetails,
  makeSession,
  makeSessionSet,
} from '../../../../domain/training/services/__tests__/training-service-test-support';
import { buildFinishTrainingTool } from '../finish-training.tool';

import { type InvokableTool, makeConfig, makeDeps, makeTrainingService } from './log-set-test-support';

const HOUR = 60 * 60 * 1000;
const BENCH_ID = 'd8794819-ffc6-4d08-8336-d9bedc4e554a';

function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

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

describe('retro-timestamps (BUG-043) — log_set', () => {
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
    expect(opts.createdAt?.getTime()).toBe(session.lastActivityAt.getTime() + 5 * 60 * 1000);
    expect(renderedContent(result)).toContain('(retro-logged)');
  });
});

describe('retro-timestamps (BUG-043) — finish_training', () => {
  it('AC-RT-2: a stale finish whose lastActivityAt precedes startedAt does not complete the session before it started', async () => {
    const service = makeTrainingService();
    const lastActivityAt = new Date(Date.now() - 3 * HOUR);
    const session: WorkoutSessionWithDetails = {
      ...makeSession(),
      lastActivityAt,
      // startedAt is written by the app clock a few ms after the row's DB-clock last_activity_at.
      startedAt: new Date(lastActivityAt.getTime() + 77),
    };
    service.getSessionDetails.mockResolvedValue(session);
    service.completeSession.mockResolvedValue({ ...session, status: 'completed', durationMinutes: 0 });
    const tool = buildFinishTrainingTool({ trainingService: service }) as unknown as InvokableTool;
    const config: RunnableConfig = makeConfig('u1', 'session-1');

    await tool.invoke({}, config);

    const [, , completedAt] = service.completeSession.mock.calls[0]!;
    // `undefined` means "now" (fine); an explicit date must not precede startedAt.
    if (completedAt !== undefined) {
      expect(completedAt.getTime()).toBeGreaterThanOrEqual(session.startedAt!.getTime());
    }
  });
});
