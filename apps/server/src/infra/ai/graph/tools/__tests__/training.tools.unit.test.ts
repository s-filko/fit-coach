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

const makeTrainingService = (): jest.Mocked<ITrainingService> =>
  ({
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
  }) as unknown as jest.Mocked<ITrainingService>;

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
  const byName = (name: string) => tools.find(t => t.name === name) as InvokableTool;
  return { tools, byName, pendingTransitions, currentSessionIds };
};

describe('buildTrainingTools', () => {
  describe('log_set', () => {
    it('calls logSetWithContext with flat fields converted to setData object', async () => {
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
      const result = await byName('log_set').invoke(
        {
          exerciseId: 12,
          ...FLAT_SET_INPUT,
          rpe: 8,
        },
        makeConfig('u1'),
      );

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

    it('returns SYSTEM_ERROR when no sessionId is set for the user', async () => {
      const trainingService = makeTrainingService();

      const { byName } = makeDeps(trainingService, null);
      const result = await byName('log_set').invoke(
        {
          exerciseId: 12,
          ...FLAT_SET_INPUT,
        },
        makeConfig('u1'),
      );

      expect(result).toContain(SYSTEM_ERROR_PREFIX);
      expect(trainingService.logSetWithContext).not.toHaveBeenCalled();
    });

    it('ignores order field — does not pass it to logSetWithContext', async () => {
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

    it('returns LLM_ERROR when logSetWithContext throws', async () => {
      const trainingService = makeTrainingService();
      trainingService.logSetWithContext.mockRejectedValue(new Error('Exercise not found'));

      const { byName } = makeDeps(trainingService);
      const result = await byName('log_set').invoke(
        {
          exerciseId: 99,
          ...FLAT_SET_INPUT,
        },
        makeConfig('u1'),
      );

      expect(result).toContain(LLM_ERROR_PREFIX);
      expect(result).toContain('Exercise not found');
    });
  });

  describe('next_exercise', () => {
    it('calls completeCurrentExercise and returns confirmation', async () => {
      const trainingService = makeTrainingService();
      trainingService.completeCurrentExercise.mockResolvedValue(undefined);

      const { byName } = makeDeps(trainingService);
      const result = await byName('next_exercise').invoke({}, makeConfig('u1'));

      expect(trainingService.completeCurrentExercise).toHaveBeenCalledWith('session-1');
      expect(result).toContain('complete');
    });

    it('returns SYSTEM_ERROR when no sessionId is set for the user', async () => {
      const trainingService = makeTrainingService();

      const { byName } = makeDeps(trainingService, null);
      const result = await byName('next_exercise').invoke({}, makeConfig('u1'));

      expect(result).toContain(SYSTEM_ERROR_PREFIX);
      expect(trainingService.completeCurrentExercise).not.toHaveBeenCalled();
    });

    it('returns LLM_ERROR when completeCurrentExercise throws', async () => {
      const trainingService = makeTrainingService();
      trainingService.completeCurrentExercise.mockRejectedValue(new Error('No exercise in progress'));

      const { byName } = makeDeps(trainingService);
      const result = await byName('next_exercise').invoke({}, makeConfig('u1'));

      expect(result).toContain(LLM_ERROR_PREFIX);
      expect(result).toContain('No exercise in progress');
    });
  });

  describe('skip_exercise', () => {
    it('calls skipCurrentExercise with reason and returns confirmation', async () => {
      const trainingService = makeTrainingService();
      trainingService.skipCurrentExercise.mockResolvedValue(undefined);

      const { byName } = makeDeps(trainingService);
      const result = await byName('skip_exercise').invoke({ reason: 'equipment busy' }, makeConfig('u1'));

      expect(trainingService.skipCurrentExercise).toHaveBeenCalledWith('session-1', 'equipment busy');
      expect(result).toContain('skipped');
    });

    it('returns SYSTEM_ERROR when no sessionId is set for the user', async () => {
      const trainingService = makeTrainingService();

      const { byName } = makeDeps(trainingService, null);
      const result = await byName('skip_exercise').invoke({ reason: 'pain' }, makeConfig('u1'));

      expect(result).toContain(SYSTEM_ERROR_PREFIX);
      expect(trainingService.skipCurrentExercise).not.toHaveBeenCalled();
    });
  });

  describe('finish_training', () => {
    it('calls completeSession, sets pendingTransitions entry, returns summary', async () => {
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

    it('returns SYSTEM_ERROR when no sessionId is set for the user', async () => {
      const trainingService = makeTrainingService();

      const { byName } = makeDeps(trainingService, null);
      const result = await byName('finish_training').invoke({}, makeConfig('u1'));

      expect(result).toContain(SYSTEM_ERROR_PREFIX);
      expect(trainingService.completeSession).not.toHaveBeenCalled();
    });

    it('returns LLM_ERROR when completeSession throws', async () => {
      const trainingService = makeTrainingService();
      trainingService.completeSession.mockRejectedValue(new Error('Session not found'));

      const { byName } = makeDeps(trainingService);
      const result = await byName('finish_training').invoke({}, makeConfig('u1'));

      expect(result).toContain(LLM_ERROR_PREFIX);
      expect(result).toContain('Session not found');
    });

    it('isolates pendingTransitions by userId — two users do not overwrite each other', async () => {
      const trainingService = makeTrainingService();
      const mockSession: WorkoutSession = {
        id: 'session-1',
        userId: 'u',
        planId: null,
        sessionKey: null,
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        durationMinutes: 30,
        userContextJson: null,
        sessionPlanJson: null,
        lastActivityAt: new Date(),
        autoCloseReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      trainingService.completeSession.mockResolvedValue(mockSession);

      const pendingTransitions = new Map<string, TransitionRequest | null>();
      const currentSessionIds = new Map<string, string | null>();
      currentSessionIds.set('userA', 'session-A');
      currentSessionIds.set('userB', 'session-B');
      const tools = buildTrainingTools({ trainingService, pendingTransitions, currentSessionIds });
      const finishTraining = tools.find(t => t.name === 'finish_training') as InvokableTool;

      await finishTraining.invoke({}, makeConfig('userA'));
      await finishTraining.invoke({}, makeConfig('userB'));

      expect(pendingTransitions.get('userA')).toEqual({ toPhase: 'chat', reason: 'training_completed' });
      expect(pendingTransitions.get('userB')).toEqual({ toPhase: 'chat', reason: 'training_completed' });
    });
  });

  // -------------------------------------------------------------------------
  // ADR-0011 Phase 1.4: log_set auto-complete notice
  // WHY RED: current log_set handler ignores autoCompleted — field not in return type
  // -------------------------------------------------------------------------

  describe('log_set — auto-complete notice (ADR-0011 Fix 1.3)', () => {
    it('should include auto-complete notice when exercise switches', async () => {
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

      const mockResult = {
        set: mockSet,
        setNumber: 1,
        autoCompleted: { exerciseId: 10, exerciseName: 'Lateral Raise', setsLogged: 4 },
      };
      trainingService.logSetWithContext.mockResolvedValue(mockResult);

      const { byName } = makeDeps(trainingService);
      const result = await byName('log_set').invoke(
        { exerciseId: 12, ...FLAT_SET_INPUT },
        makeConfig('u1'),
      );

      expect(result).toContain('auto-completed');
      expect(result).toContain('Lateral Raise');
    });

    it('should NOT include auto-complete notice when no switch occurred', async () => {
      const trainingService = makeTrainingService();
      const mockSet: SessionSet = {
        id: 'set-1',
        sessionExerciseId: 'ex-1',
        setNumber: 2,
        rpe: null,
        userFeedback: null,
        createdAt: new Date(),
        completedAt: null,
        setData: EXPECTED_SET_DATA,
      };
      trainingService.logSetWithContext.mockResolvedValue({ set: mockSet, setNumber: 2 });

      const { byName } = makeDeps(trainingService);
      const result = await byName('log_set').invoke(
        { exerciseId: 12, ...FLAT_SET_INPUT },
        makeConfig('u1'),
      );

      expect(result).not.toContain('auto-completed');
      expect(result).toContain('Set 2 logged');
    });
  });

  // -------------------------------------------------------------------------
  // ADR-0011 Phase 2.3: next_exercise with exerciseId
  // WHY RED: current schema is z.object({}) — exerciseId stripped; handler only
  //          calls completeCurrentExercise, never startNextExercise
  // -------------------------------------------------------------------------

  describe('next_exercise — exerciseId param (ADR-0011 Fix 2.3)', () => {
    it('should navigate to specific exercise when exerciseId is provided', async () => {
      const trainingService = makeTrainingService();
      trainingService.completeCurrentExercise.mockResolvedValue(undefined);
      trainingService.startNextExercise.mockResolvedValue({
        id: 'se-5',
        sessionId: 'session-1',
        exerciseId: 5,
        orderIndex: 1,
        status: 'in_progress',
        targetSets: 3,
        targetReps: '10-12',
        targetWeight: null,
        actualRepsRange: null,
        userFeedback: null,
        createdAt: new Date(),
      });

      const { byName } = makeDeps(trainingService);
      await byName('next_exercise').invoke({ exercise_id: 5 }, makeConfig('u1'));

      expect(trainingService.startNextExercise).toHaveBeenCalledWith('session-1', 5);
    });

    it('should still work without exerciseId (current behavior)', async () => {
      const trainingService = makeTrainingService();
      trainingService.completeCurrentExercise.mockResolvedValue(undefined);

      const { byName } = makeDeps(trainingService);
      const result = await byName('next_exercise').invoke({}, makeConfig('u1'));

      expect(trainingService.completeCurrentExercise).toHaveBeenCalledWith('session-1');
      expect(result).toContain('complete');
    });
  });

  // -------------------------------------------------------------------------
  // ADR-0011 Phase 2.1: delete_last_sets tool
  // WHY RED: tool does not exist — only 4 tools returned by buildTrainingTools
  // -------------------------------------------------------------------------

  describe('delete_last_sets (ADR-0011 Fix 2.1)', () => {
    it('should be available in training tools', () => {
      const { tools } = makeDeps(makeTrainingService());

      expect(tools.map(t => t.name as string)).toContain('delete_last_sets');
    });
  });

  // -------------------------------------------------------------------------
  // ADR-0011 Phase 2.2: update_last_set tool
  // WHY RED: tool does not exist — only 4 tools returned by buildTrainingTools
  // -------------------------------------------------------------------------

  describe('update_last_set (ADR-0011 Fix 2.2)', () => {
    it('should be available in training tools', () => {
      const { tools } = makeDeps(makeTrainingService());

      expect(tools.map(t => t.name as string)).toContain('update_last_set');
    });
  });

  // -------------------------------------------------------------------------
  // ADR-0011 P3: Correction-triggered phantom sets (two-turn incident replay)
  //
  // Incident scenario (March 3, 2026):
  //   Turn 1 — user says "that was my first set" (correction intent).
  //            LLM misclassifies as new set → calls log_set → phantom created.
  //   Turn 2 — user says "no, delete that" (correction intent).
  //            LLM has NO delete tool → only option is log_set again → more phantoms.
  //
  // These tests verify the structural preconditions of the incident:
  //   (a) Before fix: log_set is called twice for a "correction" message because
  //       the LLM has no alternative — zero correction tools available.
  //   (b) After fix: delete_last_sets exists — LLM can correct without adding phantoms.
  //
  // WHY RED for (b): delete_last_sets does not exist yet in buildTrainingTools.
  // -------------------------------------------------------------------------

  describe('P3 incident replay — correction misclassified as new set', () => {
    it('(before fix) calling log_set twice produces two DB writes — no way to undo', async () => {
      // Simulate what happened: LLM called log_set on "first set" message
      // and again when user "corrected" — both succeed, both write to DB.
      // This test documents the current (broken) behavior — it passes today
      // and should remain green after fixes (the fix adds correction tools,
      // it does not prevent log_set from being called multiple times intentionally).
      const trainingService = makeTrainingService();
      const makeSet = (n: number): SessionSet => ({
        id: `set-${n}`,
        sessionExerciseId: 'ex-1',
        setNumber: n,
        rpe: null,
        userFeedback: null,
        createdAt: new Date(),
        completedAt: null,
        setData: EXPECTED_SET_DATA,
      });

      trainingService.logSetWithContext
        .mockResolvedValueOnce({ set: makeSet(1), setNumber: 1 })
        .mockResolvedValueOnce({ set: makeSet(2), setNumber: 2 });

      const { byName } = makeDeps(trainingService);

      // Turn 1: user says "that was my first set" → LLM calls log_set
      await byName('log_set').invoke({ exerciseId: 12, ...FLAT_SET_INPUT }, makeConfig('u1'));
      // Turn 2: user says "no no, remove last one" → LLM has no delete tool,
      //         calls log_set again trying to "correct" by re-logging
      await byName('log_set').invoke({ exerciseId: 12, ...FLAT_SET_INPUT }, makeConfig('u1'));

      // Both calls succeed — 2 DB writes for what should have been 1 set
      expect(trainingService.logSetWithContext).toHaveBeenCalledTimes(2);
    });

    it('(after fix) LLM can call delete_last_sets to correct without adding phantom', async () => {
      // After fix: delete_last_sets tool exists.
      // LLM receives correction intent → calls delete_last_sets, NOT log_set again.
      // Verifies the structural fix: the tool must be available for LLM to use it.
      //
      // WHY RED: delete_last_sets does not exist yet in buildTrainingTools
      const trainingService = makeTrainingService();
      const { tools } = makeDeps(trainingService);

      // Cast to string to bypass TS literal type narrowing — the point is to check
      // runtime tool names, which after the fix will include 'delete_last_sets'.
      const toolNames = tools.map(t => t.name as string);
      const hasDeleteTool = toolNames.includes('delete_last_sets');

      // This is the key structural assertion: without this tool, correction is impossible.
      // When this is RED → LLM has no choice but to call log_set → phantom sets.
      // When this is GREEN → LLM can call delete_last_sets → no phantom.
      expect(hasDeleteTool).toBe(true);
    });

    it('(after fix) LLM can call update_last_set to fix wrong weight without adding phantom', async () => {
      // Scenario: user reported "10 reps at 80kg" but meant "10 reps at 70kg"
      // Before fix: no update tool → LLM adds another log_set with corrected weight
      //             → original wrong set stays + new set added = phantom
      // After fix: LLM calls update_last_set → original set updated, no phantom created
      //
      // WHY RED: update_last_set does not exist yet in buildTrainingTools
      const trainingService = makeTrainingService();
      const { tools } = makeDeps(trainingService);

      const toolNames = tools.map(t => t.name as string);
      const hasUpdateTool = toolNames.includes('update_last_set');

      expect(hasUpdateTool).toBe(true);
    });
  });
});
