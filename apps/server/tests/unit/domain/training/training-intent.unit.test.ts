import { describe, expect, it } from '@jest/globals';

import {
  JustChatIntentSchema,
  LLMTrainingResponseSchema,
  LogSetIntentSchema,
  NextExerciseIntentSchema,
  parseTrainingResponse,
  SkipExerciseIntentSchema,
  TrainingIntentSchema,
} from '@domain/training/training-intent.types';

describe('Training Intent Types', () => {
  describe('LogSetIntentSchema', () => {
    it('should validate strength set intent', () => {
      const data = {
        type: 'log_set',
        setData: {
          type: 'strength',
          reps: 10,
          weight: 100,
          weightUnit: 'kg',
        },
        rpe: 8,
      };

      const result = LogSetIntentSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should validate cardio distance set intent', () => {
      const data = {
        type: 'log_set',
        setData: {
          type: 'cardio_distance',
          distance: 5,
          distanceUnit: 'km',
          duration: 1800,
        },
      };

      const result = LogSetIntentSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid RPE', () => {
      const data = {
        type: 'log_set',
        setData: {
          type: 'strength',
          reps: 10,
        },
        rpe: 11, // invalid, max is 10
      };

      const result = LogSetIntentSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('NextExerciseIntentSchema', () => {
    it('should validate next exercise intent', () => {
      const data = {
        type: 'next_exercise',
      };

      const result = NextExerciseIntentSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should validate with optional reason', () => {
      const data = {
        type: 'next_exercise',
        reason: 'completed all sets',
      };

      const result = NextExerciseIntentSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('SkipExerciseIntentSchema', () => {
    it('should validate skip exercise intent', () => {
      const data = {
        type: 'skip_exercise',
        reason: 'equipment not available',
      };

      const result = SkipExerciseIntentSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('JustChatIntentSchema', () => {
    it('should validate just chat intent', () => {
      const data = {
        type: 'just_chat',
      };

      const result = JustChatIntentSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('TrainingIntentSchema', () => {
    it('should validate discriminated union with log_set', () => {
      const data = {
        type: 'log_set',
        setData: {
          type: 'strength',
          reps: 8,
          weight: 80,
        },
      };

      const result = TrainingIntentSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should validate discriminated union with next_exercise', () => {
      const data = {
        type: 'next_exercise',
      };

      const result = TrainingIntentSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid type', () => {
      const data = {
        type: 'invalid_intent',
      };

      const result = TrainingIntentSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject camelCase intent types (regression test for naming mismatch bug)', () => {
      const camelCaseIntents = [
        { type: 'logSet', setData: { type: 'strength', reps: 10 } },
        { type: 'nextExercise' },
        { type: 'skipExercise', reason: 'test' },
        { type: 'finishTraining' },
        { type: 'requestAdvice' },
        { type: 'modifySession', modification: 'test' },
        { type: 'justChat' },
      ];

      camelCaseIntents.forEach((data) => {
        const result = TrainingIntentSchema.safeParse(data);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('LLMTrainingResponseSchema', () => {
    it('should validate response with log_set intent', () => {
      const data = {
        message: 'Отлично! Записал подход.',
        intent: {
          type: 'log_set',
          setData: {
            type: 'strength',
            reps: 10,
            weight: 100,
            weightUnit: 'kg',
          },
          rpe: 8,
        },
      };

      const result = LLMTrainingResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject response without intent (intent is now required)', () => {
      const data = {
        message: 'Продолжай в том же духе!',
      };

      const result = LLMTrainingResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('intent');
      }
    });

    it('should validate response with phase transition', () => {
      const data = {
        message: 'Отличная тренировка!',
        intent: {
          type: 'finish_training',
        },
        phaseTransition: {
          toPhase: 'chat',
          reason: 'training_completed',
        },
      };

      const result = LLMTrainingResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing message', () => {
      const data = {
        intent: {
          type: 'next_exercise',
        },
      };

      const result = LLMTrainingResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('parseTrainingResponse', () => {
    it('should parse valid JSON with intent', () => {
      const json = JSON.stringify({
        message: 'Записал!',
        intent: {
          type: 'log_set',
          setData: {
            type: 'strength',
            reps: 10,
            weight: 100,
          },
          rpe: 8,
        },
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toBe('Записал!');
      expect(result.intent?.type).toBe('log_set');
    });

    it('should reject JSON without intent (intent is now required)', () => {
      const json = JSON.stringify({
        message: 'Продолжай!',
      });

      expect(() => parseTrainingResponse(json)).toThrow('Invalid training response format');
    });

    it('should throw on invalid JSON', () => {
      const invalidJson = '{ invalid }';

      expect(() => parseTrainingResponse(invalidJson)).toThrow('Failed to parse training response');
    });

    it('should throw on invalid schema', () => {
      const json = JSON.stringify({
        // missing required 'message' field
        intent: {
          type: 'next_exercise',
        },
      });

      expect(() => parseTrainingResponse(json)).toThrow('Invalid training response format');
    });
  });

  describe('Real-world training scenarios', () => {
    it('should handle logging strength set', () => {
      const json = JSON.stringify({
        message: 'Отлично! Записал подход: 10 повторов с 100 кг.',
        intent: {
          type: 'log_set',
          setData: {
            type: 'strength',
            reps: 10,
            weight: 100,
            weightUnit: 'kg',
          },
          rpe: 8,
          feedback: 'Felt strong',
        },
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('Записал');
      expect(result.intent?.type).toBe('log_set');
      if (result.intent?.type === 'log_set') {
        expect(result.intent.rpe).toBe(8);
        expect(result.intent.feedback).toBe('Felt strong');
      }
    });

    it('should handle moving to next exercise', () => {
      const json = JSON.stringify({
        message: 'Отлично! Переходим к следующему упражнению.',
        intent: {
          type: 'next_exercise',
          reason: 'completed_all_sets',
        },
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('следующему');
      expect(result.intent?.type).toBe('next_exercise');
    });

    it('should handle skipping exercise', () => {
      const json = JSON.stringify({
        message: 'Понял, пропускаем это упражнение.',
        intent: {
          type: 'skip_exercise',
          reason: 'equipment_unavailable',
        },
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('пропускаем');
      expect(result.intent?.type).toBe('skip_exercise');
    });

    it('should handle finishing training', () => {
      const json = JSON.stringify({
        message: 'Отличная работа! Тренировка завершена.',
        intent: {
          type: 'finish_training',
          feedback: 'Great session',
        },
        phaseTransition: {
          toPhase: 'chat',
          reason: 'training_completed',
        },
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('завершена');
      expect(result.intent?.type).toBe('finish_training');
      expect(result.phaseTransition?.toPhase).toBe('chat');
    });

    it('should handle advice request', () => {
      const json = JSON.stringify({
        message: 'Для жима лежа важно держать лопатки сведенными...',
        intent: {
          type: 'request_advice',
          topic: 'bench_press_form',
        },
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('лопатки');
      expect(result.intent?.type).toBe('request_advice');
    });

    it('should handle just chatting during training', () => {
      const json = JSON.stringify({
        message: 'Да, сегодня отличная погода!',
        intent: {
          type: 'just_chat',
        },
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('погода');
      expect(result.intent?.type).toBe('just_chat');
    });

    it('should handle session modification', () => {
      const json = JSON.stringify({
        message: 'Хорошо, заменю приседания на жим ногами.',
        intent: {
          type: 'modify_session',
          modification: 'replace squat with leg press',
        },
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('заменю');
      expect(result.intent?.type).toBe('modify_session');
    });
  });
});
