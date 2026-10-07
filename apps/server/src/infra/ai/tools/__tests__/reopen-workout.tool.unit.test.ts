/**
 * `reopen_workout` (BUG-053, stale-session-autoclose plan T2 / AC-SSA-2): returns the user's
 * most recent finished workout to training — the tool calls `reopenLastSession`, requests the
 * transition to training with the session as activeSessionId, and its result states facts only
 * (which workout, when it ran, how much of it is logged). Typed refusals relay the domain
 * message for the model to pass on.
 */
import type { RunnableConfig } from '@langchain/core/runnables';

import { ActiveSessionExistsError, NoCompletedSessionError } from '@domain/training/errors';
import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { LLM_ERROR_PREFIX, toToolMessage } from '@infra/ai/tools/outcome';

import {
  makeExerciseWithDetails,
  makeSession,
  makeSessionSet,
} from '../../../../domain/training/services/__tests__/training-service-test-support';
import { buildReopenWorkoutTool } from '../reopen-workout.tool';

type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

/** Renders a tool return exactly as the executor will. */
function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

const makeTrainingService = (): jest.Mocked<ITrainingService> =>
  ({
    reopenLastSession: jest.fn(),
  }) as unknown as jest.Mocked<ITrainingService>;

const makeConfig = (userId = 'u1'): RunnableConfig =>
  ({
    configurable: { userId, thread_id: userId },
    context: {
      runId: 'run-reopen-1',
      userId,
      user: { id: userId, languageCode: 'ru', timezone: 'Europe/Berlin' },
      now: new Date('2026-10-08T15:00:00.000Z'),
      client: 'telegram',
      trigger: 'user_message',
    },
  }) as unknown as RunnableConfig;

/** A reopened upper_a: started 09:54, last activity 11:31, 1 of 2 exercises with sets. */
const reopenedSession = (): WorkoutSessionWithDetails =>
  ({
    ...makeSession([
      makeExerciseWithDetails({ exerciseId: 'ex-bench', sets: [makeSessionSet()] }),
      makeExerciseWithDetails({ id: 'se-2', exerciseId: 'ex-pull' }),
    ]),
    sessionKey: 'upper_a',
    status: 'in_progress',
    startedAt: new Date('2026-10-08T06:54:00.000Z'),
    lastActivityAt: new Date('2026-10-08T08:31:00.000Z'),
    reopenedAt: new Date('2026-10-08T15:00:00.000Z'),
    exercises: [
      makeExerciseWithDetails({ exerciseId: 'ex-bench', sets: [makeSessionSet()] }),
      makeExerciseWithDetails({ id: 'se-2', exerciseId: 'ex-pull' }),
    ],
  }) as WorkoutSessionWithDetails;

describe('reopen-workout.tool — reopen_workout (BUG-053 T2, AC-SSA-2)', () => {
  it('reopens through the service, transitions to training with the session, states facts only', async () => {
    const trainingService = makeTrainingService();
    trainingService.reopenLastSession.mockResolvedValue(reopenedSession());
    const reopenWorkout = buildReopenWorkoutTool({ trainingService }) as unknown as InvokableTool;

    const result = (await reopenWorkout.invoke({}, makeConfig())) as ToolReturn;

    expect(trainingService.reopenLastSession).toHaveBeenCalledWith('u1');
    expect(isToolReturnWithUpdate(result)).toBe(true);
    if (isToolReturnWithUpdate(result)) {
      expect(result.update).toEqual({
        pendingTransition: { toPhase: 'training', reason: 'workout_reopened' },
        activeSessionId: 'session-1',
      });
    }
    const text = renderedContent(result);
    // Facts: which workout, its window, how much is logged; no instructions.
    expect(text).toContain('upper_a');
    expect(text).toContain('reopened');
    expect(text).toContain('started');
    expect(text).toContain('1 of 2 exercises logged');
    expect(text).not.toMatch(/\b(always|never|must|write a message|ask the user)\b/i);
  });

  it('an active session refusal relays the domain message (user-facing fact, no state change)', async () => {
    const trainingService = makeTrainingService();
    trainingService.reopenLastSession.mockRejectedValue(new ActiveSessionExistsError());
    const reopenWorkout = buildReopenWorkoutTool({ trainingService }) as unknown as InvokableTool;

    const result = (await reopenWorkout.invoke({}, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain(LLM_ERROR_PREFIX);
    expect(renderedContent(result)).toContain('active session');
    expect(isToolReturnWithUpdate(result) ? result.update : undefined).toBeUndefined();
  });

  it('no finished workout relays the domain message', async () => {
    const trainingService = makeTrainingService();
    trainingService.reopenLastSession.mockRejectedValue(new NoCompletedSessionError());
    const reopenWorkout = buildReopenWorkoutTool({ trainingService }) as unknown as InvokableTool;

    const result = (await reopenWorkout.invoke({}, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain(LLM_ERROR_PREFIX);
    expect(renderedContent(result)).toContain('No finished workout');
    expect(isToolReturnWithUpdate(result) ? result.update : undefined).toBeUndefined();
  });

  it('an unexpected failure is a user error naming the tool, not a crash', async () => {
    const trainingService = makeTrainingService();
    trainingService.reopenLastSession.mockRejectedValue(new Error('database unavailable'));
    const reopenWorkout = buildReopenWorkoutTool({ trainingService }) as unknown as InvokableTool;

    const result = (await reopenWorkout.invoke({}, makeConfig())) as ToolReturn;

    const outcome = isToolReturnWithUpdate(result) ? result.outcome : result;
    expect(outcome).toMatchObject({ ok: false, kind: 'user_error' });
    expect(renderedContent(result)).not.toContain('database unavailable');
  });
});
