import { describe, expect, it, jest } from '@jest/globals';

import type {
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports/repository.ports';
import { SessionPlanningContextBuilder } from '@domain/training/services/session-planning-context.builder';
import type { WorkoutPlan, WorkoutSessionWithDetails } from '@domain/training/types';

describe('SessionPlanningContextBuilder', () => {
  const createMockWorkoutPlanRepo = (): jest.Mocked<IWorkoutPlanRepository> => ({
    create: jest.fn(),
    findById: jest.fn(),
    findActiveByUserId: jest.fn(),
    findByUserId: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
  });

  const createMockWorkoutSessionRepo = (): jest.Mocked<IWorkoutSessionRepository> => ({
    create: jest.fn(),
    findById: jest.fn(),
    findByIdWithDetails: jest.fn(),
    findRecentByUserId: jest.fn(),
    findRecentByUserIdWithDetails: jest.fn(),
    findActiveByUserId: jest.fn(),
    update: jest.fn(),
    complete: jest.fn(),
    updateActivity: jest.fn(),
    findTimedOut: jest.fn(),
    autoCloseTimedOut: jest.fn(),
    findLastCompletedByUserAndKey: jest.fn(),
  });

  const makeMockPlan = (): WorkoutPlan => ({
    id: 'plan-1',
    userId: 'user-1',
    name: 'Push Pull Legs',
    planJson: {
      goal: 'hypertrophy',
      trainingStyle: 'PPL',
      targetMuscleGroups: ['chest', 'back_lats', 'quads'],
      recoveryGuidelines: {
        majorMuscleGroups: { minRestDays: 2, maxRestDays: 3 },
        smallMuscleGroups: { minRestDays: 1, maxRestDays: 2 },
        highIntensity: { minRestDays: 2 },
        customRules: [],
      },
      sessionTemplates: [],
      progressionRules: [],
    },
    status: 'active',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  });

  const makeMockSession = (completedAt: Date): WorkoutSessionWithDetails => ({
    id: 'session-1',
    userId: 'user-1',
    planId: 'plan-1',
    sessionKey: 'push_a',
    status: 'completed',
    startedAt: completedAt,
    completedAt,
    durationMinutes: 60,
    userContextJson: null,
    sessionPlanJson: null,
    lastActivityAt: completedAt,
    autoCloseReason: null,
    createdAt: completedAt,
    updatedAt: completedAt,
    exercises: [
      {
        id: 'ex-1',
        sessionId: 'session-1',
        exerciseId: 1,
        orderIndex: 0,
        status: 'completed',
        targetSets: 3,
        targetReps: '8-10',
        targetWeight: '100',
        actualRepsRange: '10,10,9',
        userFeedback: null,
        createdAt: completedAt,
        exercise: {
          id: 1,
          name: 'Bench Press',
          category: 'compound',
          equipment: 'barbell',
          exerciseType: 'strength',
          description: null,
          energyCost: 'high',
          complexity: 'intermediate',
          typicalDurationMinutes: 5,
          requiresSpotter: true,
          imageUrl: null,
          videoUrl: null,
          createdAt: new Date('2024-01-01'),
          muscleGroups: [{ muscleGroup: 'chest', involvement: 'primary' }],
        },
        sets: [
          {
            id: 'set-1',
            sessionExerciseId: 'ex-1',
            setNumber: 1,
            rpe: 8,
            userFeedback: null,
            createdAt: completedAt,
            completedAt,
            setData: { type: 'strength', reps: 10, weight: 100, weightUnit: 'kg' },
          },
        ],
      },
    ],
  });

  describe('buildContext', () => {
    it('should build context with active plan and recent sessions', async () => {
      const mockPlanRepo = createMockWorkoutPlanRepo();
      const mockSessionRepo = createMockWorkoutSessionRepo();

      const mockPlan = makeMockPlan();
      const mockSession = makeMockSession(new Date('2024-01-10'));

      mockPlanRepo.findActiveByUserId.mockResolvedValue(mockPlan);
      mockSessionRepo.findRecentByUserIdWithDetails.mockResolvedValue([mockSession]);

      const builder = new SessionPlanningContextBuilder(mockPlanRepo, mockSessionRepo);
      const context = await builder.buildContext('user-1');

      expect(context.activePlan).toEqual(mockPlan);
      expect(context.recentSessions).toHaveLength(1);
      expect(context.recentSessions[0]).toEqual(mockSession);
      expect(context.daysSinceLastWorkout).toBeGreaterThanOrEqual(0);

      expect(mockPlanRepo.findActiveByUserId).toHaveBeenCalledWith('user-1');
      expect(mockSessionRepo.findRecentByUserIdWithDetails).toHaveBeenCalledWith('user-1', 5);
    });

    it('should handle user with no plan and no history', async () => {
      const mockPlanRepo = createMockWorkoutPlanRepo();
      const mockSessionRepo = createMockWorkoutSessionRepo();

      mockPlanRepo.findActiveByUserId.mockResolvedValue(null);
      mockSessionRepo.findRecentByUserIdWithDetails.mockResolvedValue([]);

      const builder = new SessionPlanningContextBuilder(mockPlanRepo, mockSessionRepo);
      const context = await builder.buildContext('user-1');

      expect(context.activePlan).toBeNull();
      expect(context.recentSessions).toHaveLength(0);
      expect(context.daysSinceLastWorkout).toBeNull();
    });

    it('should calculate days since last workout correctly', async () => {
      const mockPlanRepo = createMockWorkoutPlanRepo();
      const mockSessionRepo = createMockWorkoutSessionRepo();

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      mockPlanRepo.findActiveByUserId.mockResolvedValue(null);
      mockSessionRepo.findRecentByUserIdWithDetails.mockResolvedValue([
        makeMockSession(threeDaysAgo),
      ]);

      const builder = new SessionPlanningContextBuilder(mockPlanRepo, mockSessionRepo);
      const context = await builder.buildContext('user-1');

      expect(context.daysSinceLastWorkout).toBe(3);
    });

    it('should respect custom recentSessionsLimit', async () => {
      const mockPlanRepo = createMockWorkoutPlanRepo();
      const mockSessionRepo = createMockWorkoutSessionRepo();

      mockPlanRepo.findActiveByUserId.mockResolvedValue(null);
      mockSessionRepo.findRecentByUserIdWithDetails.mockResolvedValue([]);

      const builder = new SessionPlanningContextBuilder(mockPlanRepo, mockSessionRepo);
      await builder.buildContext('user-1', 10);

      expect(mockSessionRepo.findRecentByUserIdWithDetails).toHaveBeenCalledWith('user-1', 10);
    });
  });
});
