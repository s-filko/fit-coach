import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';

import { buildLogSetTool } from '@infra/ai/tools/log-set.tool';
import { LLM_ERROR_PREFIX, toToolMessage } from '@infra/ai/tools/outcome';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';

/**
 * log_set — integration (session-investigation-0925 R2, BUG-035, AC-SI-2).
 *
 * Promoted from tests/integration/scenarios/set-error-recovery.repro.test.ts (the AC-SI-2 case;
 * the AC-SI-1c case there is R1's and stays in the repro file untouched). Over the real
 * session_sets.rpe column: a fractional RPE ("9-10" → 9.5, the dev-session shape, F2) used to
 * fail the INSERT (the column was `integer`) — the tool caught it and returned an llm_error with
 * nothing saved. The fix moves the column to numeric(3,1) and rounds the input to the nearest
 * 0.5 before persisting, so the set now saves with its RPE.
 *
 * Requires: RUN_DB_TESTS=1 (run through db-test-lock.sh — shared fitcoach_test DB).
 */
describe('log_set — integration (BUG-035, AC-SI-2)', () => {
  const setupSession = async (label: string) => {
    const { service, userRepo, exerciseRepo } = buildRealTrainingService();
    const user = await userRepo.create(createTestUserData({ username: `log_set_int_${label}_${Date.now()}` }));
    const session = await service.startSession(user.id, {});
    return { service, exerciseRepo, sessionId: session.id };
  };

  it('saves a fractional RPE ("9-10" → 9.5), rounded to the nearest 0.5, with no LLM_ERROR', async () => {
    const { service, exerciseRepo, sessionId } = await setupSession('fractional_rpe');
    const exercises = await exerciseRepo.findAll();
    const bench = exercises.find(e => e.name === 'Barbell Bench Press');
    if (!bench) {
      throw new Error('Seed exercise "Barbell Bench Press" not found — run with RUN_DB_TESTS=1');
    }

    const tool = buildLogSetTool({ trainingService: service });
    const config: RunnableConfig = { configurable: { userId: 'u1', thread_id: 'u1', activeSessionId: sessionId } };

    const result = (await tool.invoke({ exerciseId: bench.id, reps: 8, weight: 80, rpe: 9.5 }, config)) as ToolReturn;
    const content = String(toToolMessage(isToolReturnWithUpdate(result) ? result.outcome : result, 'tc1').content);
    expect(content).not.toContain(LLM_ERROR_PREFIX);

    const details = await service.getSessionDetails(sessionId);
    const sets = details!.exercises.find(e => e.exerciseId === bench.id)!.sets;
    expect(sets).toHaveLength(1);
    expect(sets[0]!.rpe).not.toBeNull();
    expect(sets[0]!.rpe).toBe(9.5);
  });

  it('rounds a fractional RPE not already on a half-point to the nearest 0.5 before it reaches the DB', async () => {
    const { service, exerciseRepo, sessionId } = await setupSession('rounded_rpe');
    const exercises = await exerciseRepo.findAll();
    const bench = exercises.find(e => e.name === 'Barbell Bench Press');
    if (!bench) {
      throw new Error('Seed exercise "Barbell Bench Press" not found — run with RUN_DB_TESTS=1');
    }

    const tool = buildLogSetTool({ trainingService: service });
    const config: RunnableConfig = { configurable: { userId: 'u1', thread_id: 'u1', activeSessionId: sessionId } };

    await tool.invoke({ exerciseId: bench.id, reps: 8, weight: 80, rpe: 9.3 }, config);

    const details = await service.getSessionDetails(sessionId);
    const sets = details!.exercises.find(e => e.exerciseId === bench.id)!.sets;
    expect(sets[0]!.rpe).toBe(9.5);
  });
});
