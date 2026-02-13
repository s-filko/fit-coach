import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { IConversationContextService } from '@domain/conversation/ports/conversation-context.ports';
import type {
  IExerciseRepository,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import { SessionPlanningContextBuilder } from '@domain/training/services/session-planning-context.builder';
import type { Exercise } from '@domain/training/types';
import { ChatService } from '@domain/user/services/chat.service';
import type { User } from '@domain/user/services/user.service';

// Mock LLM Service
class MockLLMService {
  generateResponse = jest.fn<() => Promise<string>>().mockResolvedValue('Mock AI response');
  generateRegistrationResponse = jest.fn<() => Promise<string>>().mockResolvedValue('Mock AI response');
  generateWithSystemPrompt = jest.fn<() => Promise<string>>();
  getDebugInfo = jest.fn().mockReturnValue({});
  enableDebugMode = jest.fn();
  disableDebugMode = jest.fn();
  clearHistory = jest.fn();
}

// Mock Prompt Service
class MockPromptService {
  buildUnifiedRegistrationPrompt = jest.fn().mockReturnValue('mock registration prompt');
  buildChatSystemPrompt = jest.fn().mockReturnValue('mock chat prompt');
  buildPlanCreationPrompt = jest.fn().mockReturnValue('mock plan creation prompt');
  buildSessionPlanningSystemPrompt = jest.fn().mockReturnValue('mock session planning prompt');
  buildTrainingSystemPrompt = jest.fn().mockReturnValue('mock training prompt');
}

// Mock Training Service
class MockTrainingService {
  processIntent = jest.fn();
  getCurrentExercise = jest.fn();
  getSessionSummary = jest.fn();
}

// Mock Conversation Context Service
class MockConversationContextService {
  startNewPhase = jest.fn();
  updateContext = jest.fn();
}

// Mock Workout Plan Repository
class MockWorkoutPlanRepository {
  create = jest.fn<any>();
  findActiveByUserId = jest.fn<any>();
  findById = jest.fn<any>();
  update = jest.fn<any>();
  delete = jest.fn<any>();
}

// Mock Exercise Repository
class MockExerciseRepository {
  findAll = jest.fn<any>();
  findById = jest.fn<any>();
  findByIds = jest.fn<any>();
  findByCategory = jest.fn<any>();
  findByMuscleGroup = jest.fn<any>();
  findByEquipment = jest.fn<any>();
  count = jest.fn<any>();
}

// Mock Workout Session Repository
class MockWorkoutSessionRepository {
  create = jest.fn<any>();
  findById = jest.fn<any>();
  findByUserId = jest.fn<any>();
  findRecentByUserId = jest.fn<any>();
  update = jest.fn<any>();
  delete = jest.fn<any>();
}

describe('Plan Creation Integration', () => {
  let chatService: ChatService;
  let mockLLM: MockLLMService;
  let mockPromptService: MockPromptService;
  let mockTrainingService: MockTrainingService;
  let mockContextService: MockConversationContextService;
  let mockWorkoutPlanRepo: MockWorkoutPlanRepository;
  let mockExerciseRepo: MockExerciseRepository;
  let mockWorkoutSessionRepo: MockWorkoutSessionRepository;

  const baseUser: User = {
    id: 'test-user-id',
    username: 'testuser',
    firstName: 'Test',
    lastName: 'User',
    languageCode: 'en',
    profileStatus: 'complete',
    age: 28,
    gender: 'male',
    height: 175,
    weight: 75,
    fitnessLevel: 'intermediate',
    fitnessGoal: 'muscle_gain',
  };

  const mockExercises: Exercise[] = [
    {
      id: 1,
      name: 'Barbell Bench Press',
      category: 'compound',
      equipment: 'barbell',
      exerciseType: 'strength',
      description: 'Chest compound movement',
      energyCost: 'high',
      complexity: 'intermediate',
      typicalDurationMinutes: 12,
      requiresSpotter: true,
      imageUrl: null,
      videoUrl: null,
      createdAt: new Date(),
    },
    {
      id: 2,
      name: 'Barbell Back Squat',
      category: 'compound',
      equipment: 'barbell',
      exerciseType: 'strength',
      description: 'Leg compound movement',
      energyCost: 'very_high',
      complexity: 'advanced',
      typicalDurationMinutes: 15,
      requiresSpotter: true,
      imageUrl: null,
      videoUrl: null,
      createdAt: new Date(),
    },
  ];

  beforeEach(() => {
    mockLLM = new MockLLMService();
    mockPromptService = new MockPromptService();
    mockTrainingService = new MockTrainingService();
    mockContextService = new MockConversationContextService();
    mockWorkoutPlanRepo = new MockWorkoutPlanRepository();
    mockExerciseRepo = new MockExerciseRepository();
    mockWorkoutSessionRepo = new MockWorkoutSessionRepository();

    const mockSessionPlanningContextBuilder = new SessionPlanningContextBuilder(
      mockWorkoutPlanRepo as any,
      mockWorkoutSessionRepo as any as IWorkoutSessionRepository,
      mockExerciseRepo as any,
    );

    chatService = new ChatService(
      mockPromptService as any,
      mockLLM as any,
      mockContextService as any as IConversationContextService,
      mockTrainingService as any,
      mockWorkoutPlanRepo as any as IWorkoutPlanRepository,
      mockExerciseRepo as any as IExerciseRepository,
      mockSessionPlanningContextBuilder,
    );

    // Default: return exercises for plan creation
    mockExerciseRepo.findAll.mockResolvedValue(mockExercises);
    mockExerciseRepo.count.mockResolvedValue(mockExercises.length);
  });

  describe('plan_creation phase', () => {
    it('should load exercises and build plan creation prompt', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        message: 'Давайте создадим ваш план тренировок!',
      }));

      await chatService.processMessage(
        baseUser,
        'Хочу создать план',
        'plan_creation',
        [],
      );

      // Should load all exercises
      expect(mockExerciseRepo.findAll).toHaveBeenCalled();

      // Should build plan creation prompt with exercises
      expect(mockPromptService.buildPlanCreationPrompt).toHaveBeenCalledWith({
        user: baseUser,
        availableExercises: mockExercises,
        totalExercisesAvailable: mockExercises.length,
      });

      // Should call LLM with plan creation prompt
      expect(mockLLM.generateWithSystemPrompt).toHaveBeenCalled();
      expect(mockPromptService.buildPlanCreationPrompt).toHaveBeenCalled();
    });

    it('should save workout plan when user approves', async () => {
      const mockPlan = {
        name: 'Upper/Lower Split',
        goal: 'Muscle gain with balanced development',
        trainingStyle: 'Progressive overload with compound focus',
        targetMuscleGroups: ['chest', 'back_lats'],
        recoveryGuidelines: {
          majorMuscleGroups: { minRestDays: 2, maxRestDays: 4 },
          smallMuscleGroups: { minRestDays: 1, maxRestDays: 3 },
          highIntensity: { minRestDays: 3 },
          customRules: ['Rest when needed'],
        },
        sessionTemplates: [
          {
            key: 'upper',
            name: 'Upper Body',
            focus: 'Push/Pull',
            energyCost: 'high' as const,
            estimatedDuration: 60,
            exercises: [
              {
                exerciseId: 1,
                exerciseName: 'Bench Press',
                energyCost: 'high' as const,
                targetSets: 4,
                targetReps: '6-8',
                restSeconds: 180,
                estimatedDuration: 18,
              },
            ],
          },
        ],
        progressionRules: ['Increase weight by 2.5kg when all sets completed'],
      };

      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        message: 'Отлично! План сохранен.',
        workoutPlan: mockPlan,
        phaseTransition: {
          toPhase: 'session_planning',
          reason: 'User approved plan',
        },
      }));

      const createdPlan = {
        id: 'plan-123',
        userId: baseUser.id,
        ...mockPlan,
        status: 'active',
      };
      mockWorkoutPlanRepo.create.mockResolvedValue(createdPlan as any);
      mockWorkoutPlanRepo.findActiveByUserId.mockResolvedValue(createdPlan as any);

      const result = await chatService.processMessage(
        baseUser,
        'Да, отлично, сохраняй',
        'plan_creation',
        [],
      );

      // Should save the workout plan
      expect(mockWorkoutPlanRepo.create).toHaveBeenCalledWith(baseUser.id, {
        name: mockPlan.name,
        planJson: {
          goal: mockPlan.goal,
          trainingStyle: mockPlan.trainingStyle,
          targetMuscleGroups: mockPlan.targetMuscleGroups,
          recoveryGuidelines: mockPlan.recoveryGuidelines,
          sessionTemplates: mockPlan.sessionTemplates,
          progressionRules: mockPlan.progressionRules,
        },
        status: 'active',
      });

      // Should return LLM message
      expect(result).toBe('Отлично! План сохранен.');
    });

    it('should NOT save plan when user cancels', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        message: 'Хорошо, вернемся к планированию позже.',
        phaseTransition: {
          toPhase: 'chat',
          reason: 'User wants to postpone',
        },
      }));

      const result = await chatService.processMessage(
        baseUser,
        'Отмена, не хочу сейчас',
        'plan_creation',
        [],
      );

      // Should NOT save the workout plan
      expect(mockWorkoutPlanRepo.create).not.toHaveBeenCalled();

      // Should return LLM message
      expect(result).toBe('Хорошо, вернемся к планированию позже.');
    });

    it('should NOT save plan if no transition provided', async () => {
      const mockPlan = {
        name: 'Test Plan',
        goal: 'Muscle gain with balanced development',
        trainingStyle: 'Progressive overload with compound focus',
        targetMuscleGroups: ['chest'],
        recoveryGuidelines: {
          majorMuscleGroups: { minRestDays: 2, maxRestDays: 4 },
          smallMuscleGroups: { minRestDays: 1, maxRestDays: 3 },
          highIntensity: { minRestDays: 3 },
          customRules: ['Rest when needed'],
        },
        sessionTemplates: [
          {
            key: 'upper',
            name: 'Upper',
            focus: 'Push',
            energyCost: 'high' as const,
            estimatedDuration: 60,
            exercises: [
              {
                exerciseId: 1,
                exerciseName: 'Bench Press',
                energyCost: 'high' as const,
                targetSets: 4,
                targetReps: '6-8',
                restSeconds: 180,
                estimatedDuration: 18,
              },
            ],
          },
        ],
        progressionRules: ['Increase weight when ready'],
      };

      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        message: 'Вот предварительный план. Что думаете?',
        workoutPlan: mockPlan,
        // No phaseTransition - still discussing
      }));

      await chatService.processMessage(
        baseUser,
        'Покажи план',
        'plan_creation',
        [],
      );

      // Should NOT save the workout plan (no transition)
      expect(mockWorkoutPlanRepo.create).not.toHaveBeenCalled();
    });

    it('should handle conversation history during plan creation', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        message: 'Понял, 4 дня в неделю. Какие группы мышц приоритетны?',
      }));

      const historyMessages = [
        { role: 'user' as const, content: 'Хочу создать план' },
        { role: 'assistant' as const, content: 'Отлично! Сколько дней в неделю планируете тренироваться?' },
      ];

      await chatService.processMessage(
        baseUser,
        '4 дня в неделю',
        'plan_creation',
        historyMessages,
      );

      // Should pass history to LLM
      expect(mockLLM.generateWithSystemPrompt).toHaveBeenCalled();
      expect(mockPromptService.buildPlanCreationPrompt).toHaveBeenCalled();
    });
  });

  describe('plan creation with real LLM response structure', () => {
    it('should parse complete plan with all required fields', async () => {
      const completePlan = {
        name: 'Push/Pull/Legs Split',
        goal: 'Build muscle mass with balanced development across all muscle groups',
        trainingStyle: 'Progressive overload focusing on compound movements with isolation work',
        targetMuscleGroups: ['chest', 'back_lats', 'shoulders_front', 'quads', 'hamstrings', 'glutes'],
        recoveryGuidelines: {
          majorMuscleGroups: {
            minRestDays: 2,
            maxRestDays: 4,
          },
          smallMuscleGroups: {
            minRestDays: 1,
            maxRestDays: 3,
          },
          highIntensity: {
            minRestDays: 3,
          },
          customRules: [
            'If RPE > 8 for major compound, add +1 rest day',
            'If feeling sore, add +1 rest day',
          ],
        },
        sessionTemplates: [
          {
            key: 'push',
            name: 'Push Day',
            focus: 'Chest, Shoulders, Triceps',
            energyCost: 'high' as const,
            estimatedDuration: 75,
            exercises: [
              {
                exerciseId: 1,
                exerciseName: 'Barbell Bench Press',
                energyCost: 'high' as const,
                targetSets: 4,
                targetReps: '6-8',
                restSeconds: 180,
                estimatedDuration: 18,
              },
              {
                exerciseId: 2,
                exerciseName: 'Dumbbell Shoulder Press',
                energyCost: 'medium' as const,
                targetSets: 3,
                targetReps: '8-12',
                restSeconds: 120,
                estimatedDuration: 15,
              },
            ],
          },
          {
            key: 'pull',
            name: 'Pull Day',
            focus: 'Back, Biceps',
            energyCost: 'high' as const,
            estimatedDuration: 75,
            exercises: [
              {
                exerciseId: 3,
                exerciseName: 'Deadlift',
                energyCost: 'very_high' as const,
                targetSets: 4,
                targetReps: '5-6',
                restSeconds: 240,
                estimatedDuration: 20,
              },
            ],
          },
        ],
        progressionRules: [
          'If all sets completed with RPE < 8, increase weight by 2.5kg for upper body, 5kg for lower body',
          'Every 6 weeks, perform a deload week with 40% reduced volume',
        ],
      };

      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        message: 'Вот ваш персональный план тренировок!',
        workoutPlan: completePlan,
        phaseTransition: {
          toPhase: 'session_planning',
          reason: 'User approved the workout plan',
        },
      }));

      const createdPlan = {
        id: 'plan-123',
        userId: baseUser.id,
        ...completePlan,
        status: 'active',
      };
      mockWorkoutPlanRepo.create.mockResolvedValue(createdPlan as any);
      mockWorkoutPlanRepo.findActiveByUserId.mockResolvedValue(createdPlan as any);

      const result = await chatService.processMessage(
        baseUser,
        'Отлично, сохраняй!',
        'plan_creation',
        [],
      );

      expect(result).toContain('план');
      expect(mockWorkoutPlanRepo.create).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error on invalid LLM response format', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue('{ invalid json }');

      await expect(
        chatService.processMessage(
          baseUser,
          'Создай план',
          'plan_creation',
          [],
        ),
      ).rejects.toThrow('Failed to parse plan creation response');
    });

    it('should throw error on missing required fields', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        // Missing 'message' field
        workoutPlan: {
          name: 'Test',
        },
      }));

      await expect(
        chatService.processMessage(
          baseUser,
          'Создай план',
          'plan_creation',
          [],
        ),
      ).rejects.toThrow('Invalid plan creation response');
    });

    it('should handle repository errors gracefully', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        message: 'План готов!',
        workoutPlan: {
          name: 'Test Plan',
          goal: 'Muscle gain with balanced development',
          trainingStyle: 'Progressive overload with compound focus',
          targetMuscleGroups: ['chest'],
          recoveryGuidelines: {
            majorMuscleGroups: { minRestDays: 2, maxRestDays: 4 },
            smallMuscleGroups: { minRestDays: 1, maxRestDays: 3 },
            highIntensity: { minRestDays: 3 },
            customRules: ['Rest when needed'],
          },
          sessionTemplates: [
            {
              key: 'upper',
              name: 'Upper',
              focus: 'Push',
              energyCost: 'high' as const,
              estimatedDuration: 60,
              exercises: [
                {
                  exerciseId: 1,
                  exerciseName: 'Bench Press',
                  energyCost: 'high' as const,
                  targetSets: 4,
                  targetReps: '6-8',
                  restSeconds: 180,
                  estimatedDuration: 18,
                },
              ],
            },
          ],
          progressionRules: ['Increase weight when ready'],
        },
        phaseTransition: {
          toPhase: 'session_planning',
        },
      }));

      mockWorkoutPlanRepo.create.mockRejectedValue(new Error('Database error'));

      await expect(
        chatService.processMessage(
          baseUser,
          'Сохраняй',
          'plan_creation',
          [],
        ),
      ).rejects.toThrow('Database error');
    });
  });
});
