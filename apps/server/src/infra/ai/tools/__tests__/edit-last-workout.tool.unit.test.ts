/**
 * `edit_last_workout` (BUG-053, stale-session-autoclose plan T5 / AC-SSA-5): one tool edits the
 * user's most recent FINISHED workout in place — `add` (log_set's path and weight rules, the
 * workout's retro timestamp), `update` (update_last_set's conversions, optional setNumber),
 * `delete` (a numbered set), and no change = the exercise's sets. The workout stays closed;
 * the reply states facts only.
 */
import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';
import { RETRO_SET_OFFSET_MS } from '@domain/training/session-timing';
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { LLM_ERROR_PREFIX, toToolMessage } from '@infra/ai/tools/outcome';

import {
  makeExerciseWithDetails,
  makeSession,
  makeSessionSet,
} from '../../../../domain/training/services/__tests__/training-service-test-support';
import { buildEditLastWorkoutTool } from '../edit-last-workout.tool';

type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

const EX_ID = 'd8794819-ffc6-4d08-8336-d9bedc4e554a';
const LAST_ACTIVITY = new Date('2026-10-04T08:31:00.000Z');

const renderedContent = (ret: ToolReturn): string =>
  String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);

const strength = (setNumber: number, reps: number, weight = 55) =>
  makeSessionSet({
    id: `set-${setNumber}`,
    sessionExerciseId: 'se-bench',
    setNumber,
    setData: { type: 'strength', reps, weight, weightUnit: 'kg' },
  });

/** A finished upper_a (Sun Oct 4): Bench Press with two sets. */
const finished = (sets = [strength(1, 8), strength(2, 8)]): WorkoutSessionWithDetails =>
  ({
    ...makeSession([makeExerciseWithDetails({ id: 'se-bench', exerciseId: EX_ID, status: 'completed', sets })]),
    status: 'completed',
    sessionKey: 'upper_a',
    startedAt: new Date('2026-10-04T06:54:00.000Z'),
    completedAt: new Date('2026-10-04T08:32:00.000Z'),
    lastActivityAt: LAST_ACTIVITY,
  }) as WorkoutSessionWithDetails;

const makeTrainingService = (): jest.Mocked<ITrainingService> =>
  ({
    getLastFinishedSession: jest.fn(),
    getSessionDetails: jest.fn(),
    logSetWithContext: jest.fn(),
    updateLastSet: jest.fn(),
    deleteSet: jest.fn(),
    resolveExerciseIdByName: jest.fn().mockResolvedValue(EX_ID),
  }) as unknown as jest.Mocked<ITrainingService>;

const makeConfig = (): RunnableConfig =>
  ({
    configurable: { userId: 'u1', thread_id: 'u1' },
    context: {
      runId: 'run-edit-1',
      userId: 'u1',
      user: { id: 'u1', languageCode: 'ru', timezone: 'Europe/Berlin' },
      now: new Date('2026-10-08T15:00:00.000Z'),
      client: 'telegram',
      trigger: 'user_message',
    },
  }) as unknown as RunnableConfig;

const build = (trainingService: jest.Mocked<ITrainingService>) =>
  buildEditLastWorkoutTool({ trainingService }) as unknown as InvokableTool;

describe('edit-last-workout.tool — edit_last_workout (BUG-053 T5, AC-SSA-5)', () => {
  it('is named edit_last_workout and its description states what it does, no advice', () => {
    const tool = buildEditLastWorkoutTool({ trainingService: makeTrainingService() }) as unknown as InvokableTool & {
      description: string;
    };
    expect(tool.name).toBe('edit_last_workout');
    expect(tool.description).toMatch(/finished workout/i);
    expect(tool.description).not.toMatch(/\b(always|never|must|only when|use this when)\b/i);
  });

  it('add: logs through logSetWithContext with the retro timestamp, session untouched, reports the sets after', async () => {
    const svc = makeTrainingService();
    const before = finished();
    const after = finished([strength(1, 8), strength(2, 8), strength(3, 10)]);
    svc.getLastFinishedSession.mockResolvedValue(before);
    svc.logSetWithContext.mockResolvedValue({ set: strength(3, 10), setNumber: 3 });
    svc.getSessionDetails.mockResolvedValue(after);

    const result = (await build(svc).invoke(
      { action: 'add', exerciseId: EX_ID, reps: 10, weight: 55 },
      makeConfig(),
    )) as ToolReturn;

    expect(svc.logSetWithContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        exerciseId: EX_ID,
        setData: { type: 'strength', reps: 10, weight: 55, weightUnit: 'kg' },
        createdAt: new Date(LAST_ACTIVITY.getTime() + RETRO_SET_OFFSET_MS),
        skipActivityUpdate: true,
        finishedSession: true,
      }),
    );
    expect(isToolReturnWithUpdate(result)).toBe(false); // no transition, no phase change
    const text = renderedContent(result);
    expect(text).toContain('Bench Press');
    expect(text).toContain('Sun, Oct 4');
    expect(text).toContain('Set 3: 10 reps @ 55 kg');
    expect(text).toContain('set 3 added');
    expect(text).not.toMatch(/\b(always|never|must|ask the user)\b/i);
  });

  it("add: reps without a weight is handed to the service as weightOmitted (the weight_mode rule is the service's), weight 0 is a bodyweight set", async () => {
    const svc = makeTrainingService();
    svc.getLastFinishedSession.mockResolvedValue(finished());
    svc.logSetWithContext.mockResolvedValue({ set: strength(3, 8), setNumber: 3 });
    svc.getSessionDetails.mockResolvedValue(finished());

    await build(svc).invoke({ action: 'add', exerciseId: EX_ID, reps: 8 }, makeConfig());
    await build(svc).invoke({ action: 'add', exerciseId: EX_ID, reps: 8, weight: 0 }, makeConfig());

    expect(svc.logSetWithContext).toHaveBeenNthCalledWith(
      1,
      'session-1',
      expect.objectContaining({ setData: { type: 'functional_reps', reps: 8 }, weightOmitted: true }),
    );
    expect(svc.logSetWithContext).toHaveBeenNthCalledWith(
      2,
      'session-1',
      expect.objectContaining({ setData: { type: 'functional_reps', reps: 8 }, weightOmitted: false }),
    );
  });

  it('add: a name resolves through logSetWithContext (same path as log_set), invalid data is an llm_error', async () => {
    const svc = makeTrainingService();
    svc.getLastFinishedSession.mockResolvedValue(finished());

    const result = (await build(svc).invoke(
      { action: 'add', exerciseName: 'Bench Press' },
      makeConfig(),
    )) as ToolReturn;

    expect(svc.logSetWithContext).not.toHaveBeenCalled();
    expect(renderedContent(result)).toContain(LLM_ERROR_PREFIX);
    expect(renderedContent(result)).toMatch(/reps|durationSeconds|distanceKm/);
  });

  it('add: the service rejection (e.g. the weight rule) comes back as the tool error, nothing reported as saved', async () => {
    const svc = makeTrainingService();
    svc.getLastFinishedSession.mockResolvedValue(finished());
    svc.logSetWithContext.mockRejectedValue(new Error('Weight is not valid for this exercise.'));

    const result = (await build(svc).invoke(
      { action: 'add', exerciseName: 'Plank', reps: 5, weight: 10 },
      makeConfig(),
    )) as ToolReturn;

    expect(renderedContent(result)).toContain('Weight is not valid for this exercise.');
    expect(svc.getSessionDetails).not.toHaveBeenCalled();
  });

  it('update: defaults to the last set of the exercise, reports the change and the sets after', async () => {
    const svc = makeTrainingService();
    svc.getLastFinishedSession.mockResolvedValue(finished());
    svc.updateLastSet.mockResolvedValue({
      exerciseId: EX_ID,
      setNumber: 2,
      before: { setData: strength(2, 8).setData, rpe: null, userFeedback: null, setKind: null },
      after: { setData: strength(2, 10).setData, rpe: null, userFeedback: null, setKind: null },
    });
    svc.getSessionDetails.mockResolvedValue(finished([strength(1, 8), strength(2, 10)]));

    const result = (await build(svc).invoke(
      { action: 'update', exerciseId: EX_ID, reps: 10 },
      makeConfig(),
    )) as ToolReturn;

    expect(svc.updateLastSet).toHaveBeenCalledWith('session-1', EX_ID, expect.objectContaining({ reps: 10 }), {
      setNumber: undefined,
    });
    const text = renderedContent(result);
    expect(text).toContain('Set 2: 10 reps @ 55 kg');
    expect(text).toContain('set 2 updated: 8 reps @ 55 kg → 10 reps @ 55 kg');
  });

  it('update: with a setNumber targets that set', async () => {
    const svc = makeTrainingService();
    svc.getLastFinishedSession.mockResolvedValue(finished());
    svc.updateLastSet.mockResolvedValue({
      exerciseId: EX_ID,
      setNumber: 1,
      before: { setData: strength(1, 8).setData, rpe: null, userFeedback: null, setKind: null },
      after: { setData: strength(1, 6).setData, rpe: null, userFeedback: null, setKind: null },
    });
    svc.getSessionDetails.mockResolvedValue(finished([strength(1, 6), strength(2, 8)]));

    await build(svc).invoke({ action: 'update', exerciseId: EX_ID, setNumber: 1, reps: 6 }, makeConfig());

    expect(svc.updateLastSet).toHaveBeenCalledWith('session-1', EX_ID, expect.anything(), { setNumber: 1 });
  });

  it('delete: removes the numbered set and reports the sets left', async () => {
    const svc = makeTrainingService();
    svc.getLastFinishedSession.mockResolvedValue(finished());
    svc.deleteSet.mockResolvedValue({
      exerciseId: EX_ID,
      deletedSets: [{ setNumber: 2, setData: strength(2, 8).setData, rpe: null }],
    });
    svc.getSessionDetails.mockResolvedValue(finished([strength(1, 8)]));

    const result = (await build(svc).invoke(
      { action: 'delete', exerciseId: EX_ID, setNumber: 2 },
      makeConfig(),
    )) as ToolReturn;

    expect(svc.deleteSet).toHaveBeenCalledWith('session-1', EX_ID, 2);
    const text = renderedContent(result);
    expect(text).toContain('set 2 deleted: 8 reps @ 55 kg');
    expect(text).toContain('Set 1: 8 reps @ 55 kg');
  });

  it('delete without a setNumber is an llm_error naming the missing argument', async () => {
    const svc = makeTrainingService();
    svc.getLastFinishedSession.mockResolvedValue(finished());

    const result = (await build(svc).invoke({ action: 'delete', exerciseId: EX_ID }, makeConfig())) as ToolReturn;

    expect(svc.deleteSet).not.toHaveBeenCalled();
    expect(renderedContent(result)).toContain('setNumber');
  });

  it('an exercise and no change returns that exercise’s sets in the finished workout, writing nothing', async () => {
    const svc = makeTrainingService();
    svc.getLastFinishedSession.mockResolvedValue(finished());

    const result = (await build(svc).invoke({ exerciseId: EX_ID }, makeConfig())) as ToolReturn;

    const text = renderedContent(result);
    expect(text).toContain('Bench Press');
    expect(text).toContain('Set 1: 8 reps @ 55 kg');
    expect(text).toContain('Set 2: 8 reps @ 55 kg');
    expect(svc.logSetWithContext).not.toHaveBeenCalled();
    expect(svc.updateLastSet).not.toHaveBeenCalled();
    expect(svc.deleteSet).not.toHaveBeenCalled();
  });

  it('no finished workout is a user error the model relays', async () => {
    const svc = makeTrainingService();
    svc.getLastFinishedSession.mockResolvedValue(null);

    const result = (await build(svc).invoke(
      { action: 'add', exerciseId: EX_ID, reps: 10 },
      makeConfig(),
    )) as ToolReturn;

    const outcome = isToolReturnWithUpdate(result) ? result.outcome : result;
    expect(outcome).toMatchObject({ ok: false, kind: 'user_error' });
    expect(renderedContent(result)).toContain('No finished workout');
    expect(svc.logSetWithContext).not.toHaveBeenCalled();
  });
});
