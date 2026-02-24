import { describe, expect, it, jest } from '@jest/globals';

import type {
  IExerciseRepository,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports/repository.ports';
import { SessionPlanningContextBuilder } from '@domain/training/services/session-planning-context.builder';
import type { Exercise, WorkoutPlan, WorkoutSessionWithDetails } from '@domain/training/types';

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
  });

  const createMockExerciseRepo = (): jest.Mocked<IExerciseRepository> => ({
    findById: jest.fn(),
    findByIdWithMuscles: jest.fn(),
    findByIds: jest.fn(),
    findByIdsWithMuscles: jest.fn(),
    findByMuscleGroup: jest.fn(),
    search: jest.fn(),
    findAll: jest.fn(),
    findAllWithMuscles: jest.fn(),
  });

  describe('buildContext', () => {
    it('should build context with active plan and recent sessions', async () => {
      const mockPlanRepo = createMockWorkoutPlanRepo();
      const mockSessionRepo = createMockWorkoutSessionRepo();
      const mockExerciseRepo = createMockExerciseRepo();

      const mockPlan: WorkoutPlan = {
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
      };

      const mockSession: WorkoutSessionWithDetails = {
        id: 'session-1',
        userId: 'user-1',
        planId: 'plan-1',
        sessionKey: 'push_a',
        status: 'completed',
        startedAt: new Date('2024-01-10'),
        completedAt: new Date('2024-01-10'),
        durationMinutes: 60,
        userContextJson: null,
        sessionPlanJson: null,
        lastActivityAt: new Date('2024-01-10'),
        autoCloseReason: null,
        createdAt: new Date('2024-01-10'),
        updatedAt: new Date('2024-01-10'),
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
            createdAt: new Date('2024-01-10'),
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
              muscleGroups: [
                { muscleGroup: 'chest', involvement: 'primary' },
              ],
            },
            sets: [
              {
                id: 'set-1',
                sessionExerciseId: 'ex-1',
                setNumber: 1,
                rpe: 8,
                userFeedback: null,
                createdAt: new Date('2024-01-10'),
                completedAt: new Date('2024-01-10'),
                setData: {
                  type: 'strength',
                  reps: 10,
                  weight: 100,
                  weightUnit: 'kg',
                },
              },
            ],
          },
        ],
      };

      const mockExercises: Exercise[] = [
        {
          id: 1,
          name: 'Bench Press',
          category: 'compound',
          equipment: 'barbell',
          exerciseType: 'strength',
          energyCost: 'high',
          complexity: 'intermediate',
          typicalDurationMinutes: 5,
          requiresSpotter: true,
          description: null,
          imageUrl: null,
          videoUrl: null,
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 2,
          name: 'Squat',
          category: 'compound',
          equipment: 'barbell',
          exerciseType: 'strength',
          energyCost: 'high',
          complexity: 'intermediate',
          typicalDurationMinutes: 5,
          requiresSpotter: false,
          description: null,
          imageUrl: null,
          videoUrl: null,
          createdAt: new Date('2024-01-01'),
        },
      ];

      mockPlanRepo.findActiveByUserId.mockResolvedValue(mockPlan);
      mockSessionRepo.findRecentByUserIdWithDetails.mockResolvedValue([mockSession]);
      mockExerciseRepo.findAll.mockResolvedValue(mockExercises);

      const builder = new SessionPlanningContextBuilder(
        mockPlanRepo,
        mockSessionRepo,
        mockExerciseRepo,
      );

      const context = await builder.buildContext('user-1');

      expect(context.activePlan).toEqual(mockPlan);
      expect(context.recentSessions).toHaveLength(1);
      expect(context.recentSessions[0]).toEqual(mockSession);
      expect(context.totalExercisesAvailable).toBe(2);
      expect(context.daysSinceLastWorkout).toBeGreaterThanOrEqual(0);

      expect(mockPlanRepo.findActiveByUserId).toHaveBeenCalledWith('user-1');
      expect(mockSessionRepo.findRecentByUserIdWithDetails).toHaveBeenCalledWith('user-1', 5);
      expect(mockExerciseRepo.findAll).toHaveBeenCalled();
    });

    it('should handle user with no plan and no history', async () => {
      const mockPlanRepo = createMockWorkoutPlanRepo();
      const mockSessionRepo = createMockWorkoutSessionRepo();
      const mockExerciseRepo = createMockExerciseRepo();

      mockPlanRepo.findActiveByUserId.mockResolvedValue(null);
      mockSessionRepo.findRecentByUserIdWithDetails.mockResolvedValue([]);
      mockExerciseRepo.findAll.mockResolvedValue([]);

      const builder = new SessionPlanningContextBuilder(
        mockPlanRepo,
        mockSessionRepo,
        mockExerciseRepo,
      );

      const context = await builder.buildContext('user-1');

      expect(context.activePlan).toBeNull();
      expect(context.recentSessions).toHaveLength(0);
      expect(context.totalExercisesAvailable).toBe(0);
      expect(context.daysSinceLastWorkout).toBeNull();
    });

    it('should calculate days since last workout correctly', async () => {
      const mockPlanRepo = createMockWorkoutPlanRepo();
      const mockSessionRepo = createMockWorkoutSessionRepo();
      const mockExerciseRepo = createMockExerciseRepo();

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const mockSession: WorkoutSessionWithDetails = {
        id: 'session-1',
        userId: 'user-1',
        planId: null,
        sessionKey: null,
        status: 'completed',
        startedAt: threeDaysAgo,
        completedAt: threeDaysAgo,
        durationMinutes: 45,
        userContextJson: null,
        sessionPlanJson: null,
        lastActivityAt: threeDaysAgo,
        autoCloseReason: null,
        createdAt: threeDaysAgo,
        updatedAt: threeDaysAgo,
        exercises: [],
      };

      mockPlanRepo.findActiveByUserId.mockResolvedValue(null);
      mockSessionRepo.findRecentByUserIdWithDetails.mockResolvedValue([mockSession]);
      mockExerciseRepo.findAll.mockResolvedValue([]);

      const builder = new SessionPlanningContextBuilder(
        mockPlanRepo,
        mockSessionRepo,
        mockExerciseRepo,
      );

      const context = await builder.buildContext('user-1');

      expect(context.daysSinceLastWorkout).toBe(3);
    });

    it('should respect custom recentSessionsLimit', async () => {
      const mockPlanRepo = createMockWorkoutPlanRepo();
      const mockSessionRepo = createMockWorkoutSessionRepo();
      const mockExerciseRepo = createMockExerciseRepo();

      mockPlanRepo.findActiveByUserId.mockResolvedValue(null);
      mockSessionRepo.findRecentByUserIdWithDetails.mockResolvedValue([]);
      mockExerciseRepo.findAll.mockResolvedValue([]);

      const builder = new SessionPlanningContextBuilder(
        mockPlanRepo,
        mockSessionRepo,
        mockExerciseRepo,
      );

      await builder.buildContext('user-1', 10);

      expect(mockSessionRepo.findRecentByUserIdWithDetails).toHaveBeenCalledWith('user-1', 10);
    });
  });

  describe('formatForPrompt', () => {
    it('should format context with active plan and sessions', () => {
      const mockPlanRepo = createMockWorkoutPlanRepo();
      const mockSessionRepo = createMockWorkoutSessionRepo();
      const mockExerciseRepo = createMockExerciseRepo();

      const builder = new SessionPlanningContextBuilder(
        mockPlanRepo,
        mockSessionRepo,
        mockExerciseRepo,
      );

      const context = {
        activePlan: {
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
        } as WorkoutPlan,
        recentSessions: [
          {
            id: 'session-1',
            userId: 'user-1',
            planId: 'plan-1',
            sessionKey: 'push_a',
            status: 'completed',
            startedAt: new Date('2024-01-10'),
            completedAt: new Date('2024-01-10'),
            durationMinutes: 60,
            userContextJson: null,
            lastActivityAt: new Date('2024-01-10'),
            autoCloseReason: null,
            createdAt: new Date('2024-01-10'),
            updatedAt: new Date('2024-01-10'),
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
                createdAt: new Date('2024-01-10'),
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
                    createdAt: new Date('2024-01-10'),
                    completedAt: new Date('2024-01-10'),
                    setData: { type: 'strength', reps: 10, weight: 100, weightUnit: 'kg' },
                  },
                ],
              },
            ],
          } as WorkoutSessionWithDetails,
        ],
        totalExercisesAvailable: 50,
        daysSinceLastWorkout: 2,
      };

      const formatted = builder.formatForPrompt(context);

      expect(formatted).toContain('=== Active Workout Plan ===');
      expect(formatted).toContain('Name: Push Pull Legs');
      expect(formatted).toContain('Goal: hypertrophy');
      expect(formatted).toContain('=== Recent Training History ===');
      expect(formatted).toContain('Last workout: 2 days ago');
      expect(formatted).toContain('Duration: 60 min');
      expect(formatted).toContain('Bench Press (1 sets)');
      expect(formatted).toContain('=== Exercise Catalog ===');
      expect(formatted).toContain('Total exercises available: 50');
    });

    it('should format context for new user with no data', () => {
      const mockPlanRepo = createMockWorkoutPlanRepo();
      const mockSessionRepo = createMockWorkoutSessionRepo();
      const mockExerciseRepo = createMockExerciseRepo();

      const builder = new SessionPlanningContextBuilder(
        mockPlanRepo,
        mockSessionRepo,
        mockExerciseRepo,
      );

      const context = {
        activePlan: null,
        recentSessions: [],
        totalExercisesAvailable: 0,
        daysSinceLastWorkout: null,
      };

      const formatted = builder.formatForPrompt(context);

      expect(formatted).toContain('=== No Active Plan ===');
      expect(formatted).toContain('User has no active workout plan');
      expect(formatted).toContain('=== No Training History ===');
      expect(formatted).toContain('User has not completed any workouts yet');
      expect(formatted).toContain('Total exercises available: 0');
    });

    it('should handle sessions without exercises', () => {
      const mockPlanRepo = createMockWorkoutPlanRepo();
      const mockSessionRepo = createMockWorkoutSessionRepo();
      const mockExerciseRepo = createMockExerciseRepo();

      const builder = new SessionPlanningContextBuilder(
        mockPlanRepo,
        mockSessionRepo,
        mockExerciseRepo,
      );

      const context = {
        activePlan: null,
        recentSessions: [
          {
            id: 'session-1',
            userId: 'user-1',
            planId: null,
            sessionKey: 'quick',
            status: 'completed',
            startedAt: new Date('2024-01-10'),
            completedAt: new Date('2024-01-10'),
            durationMinutes: 30,
            userContextJson: null,
            sessionPlanJson: null,
            lastActivityAt: new Date('2024-01-10'),
            autoCloseReason: null,
            createdAt: new Date('2024-01-10'),
            updatedAt: new Date('2024-01-10'),
            exercises: [],
          } as WorkoutSessionWithDetails,
        ],
        totalExercisesAvailable: 10,
        daysSinceLastWorkout: 1,
      };

      const formatted = builder.formatForPrompt(context);

      expect(formatted).toContain('Key: quick');
      expect(formatted).toContain('Duration: 30 min');
      // Empty exercises array doesn't output "Exercises: 0" - that's fine
    });
  });
});
