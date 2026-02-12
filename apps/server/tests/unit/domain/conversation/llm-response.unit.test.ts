import { describe, expect, it } from '@jest/globals';

import {
  LLMConversationResponseSchema,
  parseLLMResponse,
  PhaseTransitionSchema,
} from '@domain/conversation/llm-response.types';

describe('LLM Response Types', () => {
  describe('PhaseTransitionSchema', () => {
    it('should validate valid phase transition to chat', () => {
      const data = {
        toPhase: 'chat',
        reason: 'user_cancelled',
      };

      const result = PhaseTransitionSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toPhase).toBe('chat');
        expect(result.data.reason).toBe('user_cancelled');
      }
    });

    it('should validate phase transition with sessionId', () => {
      const data = {
        toPhase: 'training',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = PhaseTransitionSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toPhase).toBe('training');
        expect(result.data.sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
      }
    });

    it('should reject invalid phase', () => {
      const data = {
        toPhase: 'registration', // not allowed in phase transitions
      };

      const result = PhaseTransitionSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject invalid UUID format', () => {
      const data = {
        toPhase: 'training',
        sessionId: 'not-a-uuid',
      };

      const result = PhaseTransitionSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('LLMConversationResponseSchema', () => {
    it('should validate simple message without phase transition', () => {
      const data = {
        message: 'Привет! Как дела?',
      };

      const result = LLMConversationResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe('Привет! Как дела?');
        expect(result.data.phaseTransition).toBeUndefined();
      }
    });

    it('should validate message with phase transition', () => {
      const data = {
        message: 'Отлично! Давай подберем тренировку.',
        phaseTransition: {
          toPhase: 'session_planning',
          reason: 'user_requested_workout',
        },
      };

      const result = LLMConversationResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe('Отлично! Давай подберем тренировку.');
        expect(result.data.phaseTransition?.toPhase).toBe('session_planning');
        expect(result.data.phaseTransition?.reason).toBe('user_requested_workout');
      }
    });

    it('should validate training start with sessionId', () => {
      const data = {
        message: 'Начинаем тренировку!',
        phaseTransition: {
          toPhase: 'training',
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
        },
      };

      const result = LLMConversationResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.phaseTransition?.toPhase).toBe('training');
        expect(result.data.phaseTransition?.sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
      }
    });

    it('should reject missing message field', () => {
      const data = {
        phaseTransition: {
          toPhase: 'chat',
        },
      };

      const result = LLMConversationResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('parseLLMResponse', () => {
    it('should parse valid JSON string', () => {
      const json = JSON.stringify({
        message: 'Test message',
      });

      const result = parseLLMResponse(json);
      expect(result.message).toBe('Test message');
      expect(result.phaseTransition).toBeUndefined();
    });

    it('should parse JSON with phase transition', () => {
      const json = JSON.stringify({
        message: 'Давай потренируемся!',
        phaseTransition: {
          toPhase: 'session_planning',
          reason: 'user_intent',
        },
      });

      const result = parseLLMResponse(json);
      expect(result.message).toBe('Давай потренируемся!');
      expect(result.phaseTransition?.toPhase).toBe('session_planning');
      expect(result.phaseTransition?.reason).toBe('user_intent');
    });

    it('should throw error on invalid JSON', () => {
      const invalidJson = '{ invalid json }';

      expect(() => parseLLMResponse(invalidJson)).toThrow('Failed to parse LLM response');
    });

    it('should throw error on invalid schema', () => {
      const json = JSON.stringify({
        // missing required 'message' field
        phaseTransition: {
          toPhase: 'chat',
        },
      });

      expect(() => parseLLMResponse(json)).toThrow('Invalid LLM response format');
    });

    it('should throw error on invalid phase in transition', () => {
      const json = JSON.stringify({
        message: 'Test',
        phaseTransition: {
          toPhase: 'invalid_phase',
        },
      });

      expect(() => parseLLMResponse(json)).toThrow('Invalid LLM response format');
    });

    it('should throw error on invalid UUID in sessionId', () => {
      const json = JSON.stringify({
        message: 'Test',
        phaseTransition: {
          toPhase: 'training',
          sessionId: 'not-a-uuid',
        },
      });

      expect(() => parseLLMResponse(json)).toThrow('Invalid LLM response format');
    });
  });

  describe('Real-world examples', () => {
    it('should handle cancel planning scenario', () => {
      const json = JSON.stringify({
        message: 'Хорошо, давай потренируемся позже!',
        phaseTransition: {
          toPhase: 'chat',
          reason: 'user_cancelled',
        },
      });

      const result = parseLLMResponse(json);
      expect(result.message).toBe('Хорошо, давай потренируемся позже!');
      expect(result.phaseTransition?.toPhase).toBe('chat');
      expect(result.phaseTransition?.reason).toBe('user_cancelled');
    });

    it('should handle start training scenario', () => {
      const json = JSON.stringify({
        message: 'Отлично! Начинаем тренировку по плану "Push Day".',
        phaseTransition: {
          toPhase: 'training',
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      const result = parseLLMResponse(json);
      expect(result.message).toContain('Push Day');
      expect(result.phaseTransition?.toPhase).toBe('training');
      expect(result.phaseTransition?.sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should handle finish training scenario', () => {
      const json = JSON.stringify({
        message: 'Отличная работа! Тренировка завершена.',
        phaseTransition: {
          toPhase: 'chat',
          reason: 'training_completed',
        },
      });

      const result = parseLLMResponse(json);
      expect(result.message).toContain('завершена');
      expect(result.phaseTransition?.toPhase).toBe('chat');
      expect(result.phaseTransition?.reason).toBe('training_completed');
    });
  });
});
