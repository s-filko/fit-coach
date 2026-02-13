import { describe, expect, it } from '@jest/globals';

import {
  EnergyCostSchema,
  parsePlanCreationResponse,
  PlanCreationLLMResponseSchema,
  PlanCreationPhaseTransitionSchema,
  RecoveryGuidelinesSchema,
  SessionTemplateExerciseSchema,
  SessionTemplateSchema,
  WorkoutPlanDraftSchema,
} from '@domain/training/plan-creation.types';

describe('Plan Creation Types', () => {
  describe('EnergyCostSchema', () => {
    it('should validate valid energy cost values', () => {
      const validValues = ['very_low', 'low', 'medium', 'high', 'very_high'];
      
      validValues.forEach((value) => {
        const result = EnergyCostSchema.safeParse(value);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid energy cost', () => {
      const result = EnergyCostSchema.safeParse('invalid');
      expect(result.success).toBe(false);
    });
  });

  describe('SessionTemplateExerciseSchema', () => {
    it('should validate session template exercise', () => {
      const data = {
        exerciseId: 123,
        exerciseName: 'Bench Press',
        energyCost: 'high',
        targetSets: 3,
        targetReps: '8-12',
        restSeconds: 90,
        estimatedDuration: 15,
        notes: 'Focus on form',
      };

      const result = SessionTemplateExerciseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should validate exercise with optional weight', () => {
      const data = {
        exerciseId: 456,
        exerciseName: 'Squat',
        energyCost: 'very_high',
        targetSets: 4,
        targetReps: '6-8',
        targetWeight: 100,
        restSeconds: 180,
        estimatedDuration: 20,
      };

      const result = SessionTemplateExerciseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject exercise with too many sets', () => {
      const data = {
        exerciseId: 789,
        exerciseName: 'Deadlift',
        energyCost: 'very_high',
        targetSets: 11, // max is 10
        targetReps: '5',
        restSeconds: 240,
        estimatedDuration: 25,
      };

      const result = SessionTemplateExerciseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject exercise with invalid exerciseId', () => {
      const data = {
        exerciseId: -1, // must be positive
        exerciseName: 'Pull-ups',
        energyCost: 'medium',
        targetSets: 3,
        targetReps: '8-12',
        restSeconds: 90,
        estimatedDuration: 12,
      };

      const result = SessionTemplateExerciseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('SessionTemplateSchema', () => {
    it('should validate complete session template', () => {
      const data = {
        key: 'upper_a',
        name: 'Upper A - Chest/Back',
        focus: 'Horizontal push/pull movements',
        energyCost: 'high',
        estimatedDuration: 60,
        exercises: [
          {
            exerciseId: 1,
            exerciseName: 'Bench Press',
            energyCost: 'high',
            targetSets: 4,
            targetReps: '6-8',
            restSeconds: 120,
            estimatedDuration: 18,
          },
          {
            exerciseId: 2,
            exerciseName: 'Barbell Row',
            energyCost: 'high',
            targetSets: 3,
            targetReps: '8-12',
            restSeconds: 90,
            estimatedDuration: 15,
          },
        ],
      };

      const result = SessionTemplateSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject template with no exercises', () => {
      const data = {
        key: 'upper_a',
        name: 'Upper A',
        focus: 'Push/pull',
        energyCost: 'high',
        estimatedDuration: 60,
        exercises: [], // min 1 exercise
      };

      const result = SessionTemplateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject template with too many exercises', () => {
      const exercises = Array.from({ length: 16 }, (_, i) => ({
        exerciseId: i + 1,
        exerciseName: `Exercise ${i + 1}`,
        energyCost: 'medium' as const,
        targetSets: 3,
        targetReps: '8-12',
        restSeconds: 90,
        estimatedDuration: 12,
      }));

      const data = {
        key: 'upper_a',
        name: 'Upper A',
        focus: 'Push/pull',
        energyCost: 'high',
        estimatedDuration: 60,
        exercises, // max 15 exercises
      };

      const result = SessionTemplateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('RecoveryGuidelinesSchema', () => {
    it('should validate complete recovery guidelines', () => {
      const data = {
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
          'If RPE > 8, add +1 rest day',
          'If feeling sore, add +1 rest day',
        ],
      };

      const result = RecoveryGuidelinesSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should validate minimal recovery guidelines', () => {
      const data = {
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
        customRules: ['Rest when needed'],
      };

      const result = RecoveryGuidelinesSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject guidelines without required fields', () => {
      const data = {
        majorMuscleGroups: {
          minRestDays: 2,
        },
        // missing smallMuscleGroups, highIntensity, customRules
      };

      const result = RecoveryGuidelinesSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('WorkoutPlanDraftSchema', () => {
    it('should validate complete workout plan', () => {
      const data = {
        name: 'Upper/Lower 4-Day Split',
        goal: 'Build muscle with balanced development and strength gains',
        trainingStyle: 'Progressive overload with compound movements focus',
        targetMuscleGroups: ['chest', 'back_lats', 'quads', 'hamstrings'],
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
          customRules: ['If RPE > 8, add +1 rest day'],
        },
        sessionTemplates: [
          {
            key: 'upper_a',
            name: 'Upper A',
            focus: 'Chest/Back',
            energyCost: 'high',
            estimatedDuration: 60,
            exercises: [
              {
                exerciseId: 1,
                exerciseName: 'Bench Press',
                energyCost: 'high',
                targetSets: 4,
                targetReps: '6-8',
                restSeconds: 180,
                estimatedDuration: 18,
              },
              {
                exerciseId: 2,
                exerciseName: 'Barbell Row',
                energyCost: 'high',
                targetSets: 3,
                targetReps: '8-12',
                restSeconds: 120,
                estimatedDuration: 15,
              },
            ],
          },
        ],
        progressionRules: [
          'If all sets completed with RPE < 8, increase weight by 2.5kg for upper body exercises',
        ],
      };

      const result = WorkoutPlanDraftSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject plan with too few templates', () => {
      const data = {
        name: 'Minimal Plan',
        goal: 'Test goal with at least 10 characters',
        trainingStyle: 'Test style with at least 10 characters',
        targetMuscleGroups: ['chest'],
        recoveryGuidelines: {
          majorMuscleGroups: { minRestDays: 2, maxRestDays: 4 },
          smallMuscleGroups: { minRestDays: 1, maxRestDays: 3 },
          highIntensity: { minRestDays: 3 },
          customRules: ['Rest when needed'],
        },
        sessionTemplates: [], // min 1 template
        progressionRules: ['Increase weight when possible'],
      };

      const result = WorkoutPlanDraftSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject plan with too many templates', () => {
      const templates = Array.from({ length: 11 }, (_, i) => ({
        key: `template_${i}`,
        name: `Template ${i}`,
        focus: 'Test',
        energyCost: 'medium' as const,
        estimatedDuration: 60,
        exercises: [
          {
            exerciseId: i * 2 + 1,
            exerciseName: `Exercise ${i * 2 + 1}`,
            energyCost: 'medium' as const,
            targetSets: 3,
            targetReps: '8-12',
            restSeconds: 90,
            estimatedDuration: 12,
          },
        ],
      }));

      const data = {
        name: 'Too Many Templates',
        goal: 'Test goal with at least 10 characters',
        trainingStyle: 'Test style with at least 10 characters',
        targetMuscleGroups: ['chest'],
        recoveryGuidelines: {
          majorMuscleGroups: { minRestDays: 2, maxRestDays: 4 },
          smallMuscleGroups: { minRestDays: 1, maxRestDays: 3 },
          highIntensity: { minRestDays: 3 },
          customRules: ['Rest when needed'],
        },
        sessionTemplates: templates, // max 10 templates
        progressionRules: ['Increase weight when possible'],
      };

      const result = WorkoutPlanDraftSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('PlanCreationPhaseTransitionSchema', () => {
    it('should validate transition to session_planning', () => {
      const data = {
        toPhase: 'session_planning',
        reason: 'User approved workout plan',
      };

      const result = PlanCreationPhaseTransitionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should validate transition to chat', () => {
      const data = {
        toPhase: 'chat',
        reason: 'User wants to postpone plan creation',
      };

      const result = PlanCreationPhaseTransitionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid phase', () => {
      const data = {
        toPhase: 'training',
      };

      const result = PlanCreationPhaseTransitionSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('PlanCreationLLMResponseSchema', () => {
    it('should validate response with workout plan and transition', () => {
      const data = {
        message: 'Вот ваш план тренировок!',
        workoutPlan: {
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
              energyCost: 'high',
              estimatedDuration: 60,
              exercises: [
                {
                  exerciseId: 1,
                  exerciseName: 'Bench Press',
                  energyCost: 'high',
                  targetSets: 4,
                  targetReps: '6-8',
                  restSeconds: 180,
                  estimatedDuration: 18,
                },
              ],
            },
          ],
          progressionRules: [
            'If all sets completed, increase weight by 2.5kg',
          ],
        },
        phaseTransition: {
          toPhase: 'session_planning',
          reason: 'Plan approved',
        },
      };

      const result = PlanCreationLLMResponseSchema.safeParse(data);
      if (!result.success) {
        console.log('Validation errors:', JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
    });

    it('should validate response without plan (still discussing)', () => {
      const data = {
        message: 'Давайте обсудим ваши цели подробнее.',
      };

      const result = PlanCreationLLMResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should validate response with transition to chat (cancel)', () => {
      const data = {
        message: 'Хорошо, вернемся к планированию позже.',
        phaseTransition: {
          toPhase: 'chat',
          reason: 'User wants to postpone',
        },
      };

      const result = PlanCreationLLMResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject response with empty message', () => {
      const data = {
        message: '',
      };

      const result = PlanCreationLLMResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('parsePlanCreationResponse', () => {
    it('should parse valid JSON with plan', () => {
      const json = JSON.stringify({
        message: 'План готов!',
        workoutPlan: {
          name: 'Test Plan',
          goal: 'Strength and muscle gain with compound movements',
          trainingStyle: 'Heavy compounds with progressive overload',
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
              energyCost: 'high',
              estimatedDuration: 60,
              exercises: [
                {
                  exerciseId: 1,
                  exerciseName: 'Bench Press',
                  energyCost: 'high',
                  targetSets: 4,
                  targetReps: '6-8',
                  restSeconds: 180,
                  estimatedDuration: 18,
                },
              ],
            },
          ],
          progressionRules: ['Increase weight by 2.5kg when all sets completed'],
        },
        phaseTransition: {
          toPhase: 'session_planning',
        },
      });

      const result = parsePlanCreationResponse(json);
      expect(result.message).toBe('План готов!');
      expect(result.workoutPlan).toBeDefined();
      expect(result.workoutPlan?.name).toBe('Test Plan');
      expect(result.phaseTransition?.toPhase).toBe('session_planning');
    });

    it('should parse valid JSON without plan', () => {
      const json = JSON.stringify({
        message: 'Расскажите о ваших целях.',
      });

      const result = parsePlanCreationResponse(json);
      expect(result.message).toBe('Расскажите о ваших целях.');
      expect(result.workoutPlan).toBeUndefined();
      expect(result.phaseTransition).toBeUndefined();
    });

    it('should throw on invalid JSON', () => {
      const invalidJson = '{ invalid }';

      expect(() => parsePlanCreationResponse(invalidJson)).toThrow(
        'Failed to parse plan creation response',
      );
    });

    it('should throw on invalid schema', () => {
      const json = JSON.stringify({
        // missing required 'message' field
        workoutPlan: {
          name: 'Test',
        },
      });

      expect(() => parsePlanCreationResponse(json)).toThrow(
        'Invalid plan creation response',
      );
    });
  });

  describe('Real-world plan creation scenarios', () => {
    it('should handle initial discussion', () => {
      const json = JSON.stringify({
        message: 'Отлично! Давайте создадим план. Какая у вас основная цель?',
      });

      const result = parsePlanCreationResponse(json);
      expect(result.message).toContain('цель');
      expect(result.workoutPlan).toBeUndefined();
    });

    it('should handle plan proposal', () => {
      const json = JSON.stringify({
        message: 'Предлагаю следующий план тренировок...',
        workoutPlan: {
          name: 'Push/Pull/Legs 6-Day Split',
          goal: 'Hypertrophy and muscle definition with high volume training',
          trainingStyle: 'High volume, moderate intensity with progressive overload',
          targetMuscleGroups: [
            'chest',
            'back_lats',
            'shoulders_front',
            'quads',
            'hamstrings',
          ],
          recoveryGuidelines: {
            majorMuscleGroups: {
              minRestDays: 2,
              maxRestDays: 3,
            },
            smallMuscleGroups: {
              minRestDays: 1,
              maxRestDays: 2,
            },
            highIntensity: {
              minRestDays: 3,
            },
            customRules: ['If RPE > 9, add +1 rest day'],
          },
          sessionTemplates: [
            {
              key: 'push',
              name: 'Push Day',
              focus: 'Chest, Shoulders, Triceps',
              energyCost: 'high',
              estimatedDuration: 75,
              exercises: [
                {
                  exerciseId: 1,
                  exerciseName: 'Bench Press',
                  energyCost: 'high',
                  targetSets: 4,
                  targetReps: '6-8',
                  restSeconds: 180,
                  estimatedDuration: 18,
                },
                {
                  exerciseId: 2,
                  exerciseName: 'Shoulder Press',
                  energyCost: 'medium',
                  targetSets: 3,
                  targetReps: '8-12',
                  restSeconds: 120,
                  estimatedDuration: 15,
                },
              ],
            },
          ],
          progressionRules: [
            'If all sets completed with RPE < 8, increase weight by 2.5kg for upper body, 5kg for lower body',
            'Every 6 weeks, reduce volume by 40% for one deload week',
          ],
        },
      });

      const result = parsePlanCreationResponse(json);
      expect(result.message).toContain('план');
      expect(result.workoutPlan).toBeDefined();
      expect(result.workoutPlan?.sessionTemplates).toHaveLength(1);
    });

    it('should handle plan approval', () => {
      const json = JSON.stringify({
        message: 'Отлично! План сохранен. Готовы планировать первую тренировку?',
        phaseTransition: {
          toPhase: 'session_planning',
          reason: 'User approved the workout plan',
        },
      });

      const result = parsePlanCreationResponse(json);
      expect(result.message).toContain('сохранен');
      expect(result.phaseTransition?.toPhase).toBe('session_planning');
    });

    it('should handle plan cancellation', () => {
      const json = JSON.stringify({
        message: 'Хорошо, вернемся к планированию позже.',
        phaseTransition: {
          toPhase: 'chat',
          reason: 'User wants to postpone plan creation',
        },
      });

      const result = parsePlanCreationResponse(json);
      expect(result.message).toContain('позже');
      expect(result.phaseTransition?.toPhase).toBe('chat');
    });
  });
});
