import type { RunnableConfig } from '@langchain/core/runnables';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { ITrainingService } from '@domain/training/ports';
import type { SessionSet, WorkoutSession } from '@domain/training/types';

import { LLM_ERROR_PREFIX, SYSTEM_ERROR_PREFIX, buildTrainingTools } from '../training.tools';

type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

// Flat input fields used in the new log_set schema (no nested setData object)
const FLAT_SET_INPUT = { reps: 10, weight: 80 };
// Expected setData built by the tool handler from flat fields
const EXPECTED_SET_DATA = { type: 'strength' as const, reps: 10, weight: 80, weightUnit: 'kg' as const };

const makeTrainingService = (): jest.Mocked<ITrainingService> => ({
  startSession: jest.fn(),
  getSessionDetails: jest.fn(),
  completeSession: jest.fn(),
  skipSession: jest.fn(),
  getTrainingHistory: jest.fn(),
  getNextSessionRecommendation: jest.fn(),
  addExerciseToSession: jest.fn(),
  logSet: jest.fn(),
  startNextExercise: jest.fn(),
  skipCurrentExercise: jest.fn(),
  completeCurrentExercise: jest.fn(),
  ensureCurrentExercise: jest.fn(),
  logSetWithContext: jest.fn(),
} as unknown as jest.Mocked<ITrainingService>);

const makeConfig = (userId = 'u1'): RunnableConfig => ({
  configurable: { userId, thread_id: userId },
});

const makeDeps = (trainingService: jest.Mocked<ITrainingService>, sessionId: string | null = 'session-1') => {
  const pendingTransitions = new Map<string, TransitionRequest | null>();
  const currentSessionIds = new Map<string, string | null>();
  if (sessionId !== null) {
    currentSessionIds.set('u1', sessionId);
  }
  const tools = buildTrainingTools({ trainingService, pendingTransitions, currentSessionIds });
  const byName = (name: string) => tools.find((t) => t.name === name) as InvokableTool;
  return { tools, byName, pendingTransitions, currentSessionIds };
};

describe('buildTrainingTools', () => {
  describe('log_set', () => {
    it('calls logSetWithContext with flat fields converted to setData object', async() => {
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

      const { byName } = makeDeps(trainingService);
      const result = await byName('log_set').invoke({
        exerciseId: 12,
        ...FLAT_SET_INPUT,
        rpe: 8,
      }, makeConfig('u1'));

      expect(trainingService.logSetWithContext).toHaveBeenCalledWith('session-1', {
        exerciseId: 12,
        exerciseName: undefined,
        setData: EXPECTED_SET_DATA,
        rpe: 8,
        feedback: undefined,
      });
      expect(result).toContain('Set 2 logged');
      expect(result).toContain('10 reps @ 80 kg');
    });

    it('returns SYSTEM_ERROR when no sessionId is set for the user', async() => {
      const trainingService = makeTrainingService();

      const { byName } = makeDeps(trainingService, null);
      const result = await byName('log_set').invoke({
        exerciseId: 12,
        ...FLAT_SET_INPUT,
      }, makeConfig('u1'));

      expect(result).toContain(SYSTEM_ERROR_PREFIX);
      expect(trainingService.logSetWithContext).not.toHaveBeenCalled();
    });

    it('ignores order field — does not pass it to logSetWithContext', async() => {
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

      const { byName } = makeDeps(trainingService);
      await byName('log_set').invoke({ exerciseId: 12, ...FLAT_SET_INPUT, order: 2 }, makeConfig('u1'));

      expect(trainingService.logSetWithContext).toHaveBeenCalledWith('session-1', {
        exerciseId: 12,
        exerciseName: undefined,
        setData: EXPECTED_SET_DATA,
        rpe: undefined,
        feedback: undefined,
      });
    });

    it('returns LLM_ERROR when logSetWithContext throws', async() => {
      const trainingService = makeTrainingService();
      trainingService.logSetWithContext.mockRejectedValue(new Error('Exercise not found'));

      const { byName } = makeDeps(trainingService);
      const result = await byName('log_set').invoke({
        exerciseId: 99,
        ...FLAT_SET_INPUT,
      }, makeConfig('u1'));

      expect(result).toContain(LLM_ERROR_PREFIX);
      expect(result).toContain('Exercise not found');
    });
  });

  describe('next_exercise', () => {
    it('calls completeCurrentExercise and returns confirmation', async() => {
      const trainingService = makeTrainingService();
      trainingService.completeCurrentExercise.mockResolvedValue(undefined);

      const { byName } = makeDeps(trainingService);
      const result = await byName('next_exercise').invoke({}, makeConfig('u1'));

      expect(trainingService.completeCurrentExercise).toHaveBeenCalledWith('session-1');
      expect(result).toContain('complete');
    });

    it('returns SYSTEM_ERROR when no sessionId is set for the user', async() => {
      const trainingService = makeTrainingService();

      const { byName } = makeDeps(trainingService, null);
      const result = await byName('next_exercise').invoke({}, makeConfig('u1'));

      expect(result).toContain(SYSTEM_ERROR_PREFIX);
      expect(trainingService.completeCurrentExercise).not.toHaveBeenCalled();
    });

    it('returns LLM_ERROR when completeCurrentExercise throws', async() => {
      const trainingService = makeTrainingService();
      trainingService.completeCurrentExercise.mockRejectedValue(new Error('No exercise in progress'));

      const { byName } = makeDeps(trainingService);
      const result = await byName('next_exercise').invoke({}, makeConfig('u1'));

      expect(result).toContain(LLM_ERROR_PREFIX);
      expect(result).toContain('No exercise in progress');
    });
  });

  describe('skip_exercise', () => {
    it('calls skipCurrentExercise with reason and returns confirmation', async() => {
      const trainingService = makeTrainingService();
      trainingService.skipCurrentExercise.mockResolvedValue(undefined);

      const { byName } = makeDeps(trainingService);
      const result = await byName('skip_exercise').invoke({ reason: 'equipment busy' }, makeConfig('u1'));

      expect(trainingService.skipCurrentExercise).toHaveBeenCalledWith('session-1', 'equipment busy');
      expect(result).toContain('skipped');
    });

    it('returns SYSTEM_ERROR when no sessionId is set for the user', async() => {
      const trainingService = makeTrainingService();

      const { byName } = makeDeps(trainingService, null);
      const result = await byName('skip_exercise').invoke({ reason: 'pain' }, makeConfig('u1'));

      expect(result).toContain(SYSTEM_ERROR_PREFIX);
      expect(trainingService.skipCurrentExercise).not.toHaveBeenCalled();
    });
  });

  describe('finish_training', () => {
    it('calls completeSession, sets pendingTransitions entry, returns summary', async() => {
      const trainingService = makeTrainingService();
      const mockSession: WorkoutSession = {
        id: 'session-1',
        userId: 'user-1',
        planId: null,
        sessionKey: null,
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        durationMinutes: 45,
        userContextJson: null,
        sessionPlanJson: null,
        lastActivityAt: new Date(),
        autoCloseReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      trainingService.completeSession.mockResolvedValue(mockSession);

      const { byName, pendingTransitions } = makeDeps(trainingService);
      const result = await byName('finish_training').invoke({ feedback: 'Great session!' }, makeConfig('u1'));

      expect(trainingService.completeSession).toHaveBeenCalledWith('session-1');
      expect(pendingTransitions.get('u1')).toEqual({ toPhase: 'chat', reason: 'training_completed' });
      expect(result).toContain('45 min');
      expect(result).toContain('Great session!');
    });

    it('returns SYSTEM_ERROR when no sessionId is set for the user', async() => {
      const trainingService = makeTrainingService();

      const { byName } = makeDeps(trainingService, null);
      const result = await byName('finish_training').invoke({}, makeConfig('u1'));

      expect(result).toContain(SYSTEM_ERROR_PREFIX);
      expect(trainingService.completeSession).not.toHaveBeenCalled();
    });

    it('returns LLM_ERROR when completeSession throws', async() => {
      const trainingService = makeTrainingService();
      trainingService.completeSession.mockRejectedValue(new Error('Session not found'));

      const { byName } = makeDeps(trainingService);
      const result = await byName('finish_training').invoke({}, makeConfig('u1'));

      expect(result).toContain(LLM_ERROR_PREFIX);
      expect(result).toContain('Session not found');
    });

    it('isolates pendingTransitions by userId — two users do not overwrite each other', async() => {
      const trainingService = makeTrainingService();
      const mockSession: WorkoutSession = {
        id: 'session-1', userId: 'u', planId: null, sessionKey: null, status: 'completed',
        startedAt: new Date(), completedAt: new Date(), durationMinutes: 30,
        userContextJson: null, sessionPlanJson: null, lastActivityAt: new Date(),
        autoCloseReason: null, createdAt: new Date(), updatedAt: new Date(),
      };
      trainingService.completeSession.mockResolvedValue(mockSession);

      const pendingTransitions = new Map<string, TransitionRequest | null>();
      const currentSessionIds = new Map<string, string | null>();
      currentSessionIds.set('userA', 'session-A');
      currentSessionIds.set('userB', 'session-B');
      const tools = buildTrainingTools({ trainingService, pendingTransitions, currentSessionIds });
      const finishTraining = tools.find((t) => t.name === 'finish_training') as InvokableTool;

      await finishTraining.invoke({}, makeConfig('userA'));
      await finishTraining.invoke({}, makeConfig('userB'));

      expect(pendingTransitions.get('userA')).toEqual({ toPhase: 'chat', reason: 'training_completed' });
      expect(pendingTransitions.get('userB')).toEqual({ toPhase: 'chat', reason: 'training_completed' });
    });
  });
});
