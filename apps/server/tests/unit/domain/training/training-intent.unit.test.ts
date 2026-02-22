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
        exerciseId: 1,
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
        exerciseId: 2,
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
        exerciseId: 1,
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
        message: 'Logged set.',
        intents: [{
          type: 'log_set',
          exerciseId: 1,
          setData: {
            type: 'strength',
            reps: 10,
            weight: 100,
            weightUnit: 'kg',
          },
          rpe: 8,
        }],
      };

      const result = LLMTrainingResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject response without intents (intents is required)', () => {
      const data = {
        message: 'Keep going!',
      };

      const result = LLMTrainingResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('intents');
      }
    });

    it('should validate response with phase transition', () => {
      const data = {
        message: 'Great workout!',
        intents: [{
          type: 'finish_training',
        }],
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
        intents: [{
          type: 'next_exercise',
        }],
      };

      const result = LLMTrainingResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('parseTrainingResponse', () => {
    it('should parse valid JSON with intent', () => {
      const json = JSON.stringify({
        message: 'Logged!',
        intents: [{
          type: 'log_set',
          exerciseId: 1,
          setData: {
            type: 'strength',
            reps: 10,
            weight: 100,
          },
          rpe: 8,
        }],
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toBe('Logged!');
      expect(result.intents?.[0]?.type).toBe('log_set');
    });

    it('should reject JSON without intents (intents is now required)', () => {
      const json = JSON.stringify({
        message: 'Keep going!',
      });

      expect(() => parseTrainingResponse(json)).toThrow('Invalid training response format');
    });

    it('should throw on invalid JSON', () => {
      const invalidJson = '{ invalid }';

      expect(() => parseTrainingResponse(invalidJson)).toThrow('Failed to parse training response');
    });

    it('should throw on invalid schema', () => {
      const json = JSON.stringify({
        intents: [{ type: 'next_exercise' }],
      });

      expect(() => parseTrainingResponse(json)).toThrow('Invalid training response format');
    });
  });

  describe('parseTrainingResponse — setData.type normalization', () => {
    it('should normalize "warmup" to "strength" when reps+weight present', () => {
      const json = JSON.stringify({
        message: 'Warmup logged.',
        intents: [{
          type: 'log_set',
          exerciseId: 1,
          setData: { type: 'warmup', reps: 10, weight: 20, weightUnit: 'kg' },
        }],
      });

      const result = parseTrainingResponse(json);
      const [intent] = result.intents;
      expect(intent.type).toBe('log_set');
      if (intent.type === 'log_set') {
        expect(intent.setData.type).toBe('strength');
      }
    });

    it('should normalize "dropset" to "strength" when reps+weight present', () => {
      const json = JSON.stringify({
        message: 'Drop set logged.',
        intents: [{
          type: 'log_set',
          exerciseId: 1,
          setData: { type: 'dropset', reps: 12, weight: 40, weightUnit: 'kg' },
        }],
      });

      const result = parseTrainingResponse(json);
      if (result.intents[0].type === 'log_set') {
        expect(result.intents[0].setData.type).toBe('strength');
      }
    });

    it('should normalize unknown type to "functional_reps" when only reps present', () => {
      const json = JSON.stringify({
        message: 'Logged.',
        intents: [{
          type: 'log_set',
          exerciseId: 1,
          setData: { type: 'bodyweight', reps: 15 },
        }],
      });

      const result = parseTrainingResponse(json);
      if (result.intents[0].type === 'log_set') {
        expect(result.intents[0].setData.type).toBe('functional_reps');
      }
    });

    it('should normalize unknown type to "cardio_duration" when duration present', () => {
      const json = JSON.stringify({
        message: 'Logged.',
        intents: [{
          type: 'log_set',
          exerciseId: 1,
          setData: { type: 'timed_hold', duration: 60 },
        }],
      });

      const result = parseTrainingResponse(json);
      if (result.intents[0].type === 'log_set') {
        expect(result.intents[0].setData.type).toBe('cardio_duration');
      }
    });

    it('should normalize unknown type to "cardio_distance" when distance+distanceUnit present', () => {
      const json = JSON.stringify({
        message: 'Logged.',
        intents: [{
          type: 'log_set',
          exerciseId: 1,
          setData: { type: 'run', distance: 5, distanceUnit: 'km', duration: 1800 },
        }],
      });

      const result = parseTrainingResponse(json);
      if (result.intents[0].type === 'log_set') {
        expect(result.intents[0].setData.type).toBe('cardio_distance');
      }
    });

    it('should normalize unknown type to "interval" when workDuration+restDuration present', () => {
      const json = JSON.stringify({
        message: 'Logged.',
        intents: [{
          type: 'log_set',
          exerciseId: 1,
          setData: { type: 'hiit', workDuration: 30, restDuration: 15, rounds: 8 },
        }],
      });

      const result = parseTrainingResponse(json);
      if (result.intents[0].type === 'log_set') {
        expect(result.intents[0].setData.type).toBe('interval');
      }
    });

    it('should fall back to "strength" when unknown type has no recognizable fields', () => {
      const json = JSON.stringify({
        message: 'Logged.',
        intents: [{
          type: 'log_set',
          exerciseId: 1,
          setData: { type: 'unknown_thing', reps: 5, weight: 100 },
        }],
      });

      const result = parseTrainingResponse(json);
      if (result.intents[0].type === 'log_set') {
        expect(result.intents[0].setData.type).toBe('strength');
      }
    });

    it('should not modify already valid setData.type', () => {
      const json = JSON.stringify({
        message: 'Logged.',
        intents: [{
          type: 'log_set',
          exerciseId: 1,
          setData: { type: 'strength', reps: 10, weight: 50 },
        }],
      });

      const result = parseTrainingResponse(json);
      if (result.intents[0].type === 'log_set') {
        expect(result.intents[0].setData.type).toBe('strength');
      }
    });

    it('should normalize setData.type across multiple intents', () => {
      const json = JSON.stringify({
        message: 'Logged all sets.',
        intents: [
          { type: 'log_set', exerciseId: 1, setData: { type: 'warmup', reps: 10, weight: 20, weightUnit: 'kg' } },
          { type: 'log_set', exerciseId: 1, setData: { type: 'strength', reps: 8, weight: 50, weightUnit: 'kg' } },
          { type: 'log_set', exerciseId: 1, setData: { type: 'burnout', reps: 15, weight: 30, weightUnit: 'kg' } },
        ],
      });

      const result = parseTrainingResponse(json);
      expect(result.intents).toHaveLength(3);
      for (const intent of result.intents) {
        if (intent.type === 'log_set') {
          expect(intent.setData.type).toBe('strength');
        }
      }
    });

    it('should not touch intents without setData', () => {
      const json = JSON.stringify({
        message: 'Moving on.',
        intents: [{ type: 'next_exercise', reason: 'done' }],
      });

      const result = parseTrainingResponse(json);
      expect(result.intents[0].type).toBe('next_exercise');
    });
  });

  describe('Real-world training scenarios', () => {
    it('should handle logging strength set', () => {
      const json = JSON.stringify({
        message: 'Logged set: 10 reps @ 100 kg.',
        intents: [{
          type: 'log_set',
          exerciseId: 1,
          setData: {
            type: 'strength',
            reps: 10,
            weight: 100,
            weightUnit: 'kg',
          },
          rpe: 8,
          feedback: 'Felt strong',
        }],
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('Logged');
      expect(result.intents?.[0]?.type).toBe('log_set');
      const [intent] = result.intents!;
      if (intent.type === 'log_set') {
        expect(intent.rpe).toBe(8);
        expect(intent.feedback).toBe('Felt strong');
      }
    });

    it('should handle moving to next exercise', () => {
      const json = JSON.stringify({
        message: 'Moving to the next exercise.',
        intents: [{
          type: 'next_exercise',
          reason: 'completed_all_sets',
        }],
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('next');
      expect(result.intents?.[0]?.type).toBe('next_exercise');
    });

    it('should handle skipping exercise', () => {
      const json = JSON.stringify({
        message: 'Got it, skipping this exercise.',
        intents: [{
          type: 'skip_exercise',
          reason: 'equipment_unavailable',
        }],
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('skipping');
      expect(result.intents?.[0]?.type).toBe('skip_exercise');
    });

    it('should handle finishing training', () => {
      const json = JSON.stringify({
        message: 'Great work! Training complete.',
        intents: [{
          type: 'finish_training',
          feedback: 'Great session',
        }],
        phaseTransition: {
          toPhase: 'chat',
          reason: 'training_completed',
        },
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('complete');
      expect(result.intents?.[0]?.type).toBe('finish_training');
      expect(result.phaseTransition?.toPhase).toBe('chat');
    });

    it('should handle advice request', () => {
      const json = JSON.stringify({
        message: 'For bench press, keep your shoulder blades retracted...',
        intents: [{
          type: 'request_advice',
          topic: 'bench_press_form',
        }],
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('bench press');
      expect(result.intents?.[0]?.type).toBe('request_advice');
    });

    it('should handle just chatting during training', () => {
      const json = JSON.stringify({
        message: 'Yeah, great weather today!',
        intents: [{
          type: 'just_chat',
        }],
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('weather');
      expect(result.intents?.[0]?.type).toBe('just_chat');
    });

    it('should handle session modification', () => {
      const json = JSON.stringify({
        message: 'Sure, replacing squats with leg press.',
        intents: [{
          type: 'modify_session',
          modification: 'replace squat with leg press',
        }],
      });

      const result = parseTrainingResponse(json);
      expect(result.message).toContain('replacing');
      expect(result.intents?.[0]?.type).toBe('modify_session');
    });
  });
});
