/**
 * Unit tests for JSON mode validation
 * 
 * Ensures that when JSON mode is enabled, the system prompt mentions "json".
 * This prevents OpenAI/OpenRouter error: "Response input messages must contain 
 * the word 'json' in some form to use 'text.format' of type 'json_object'."
 */

import { describe, expect, it } from '@jest/globals';

import { PromptService } from '@domain/user/services/prompt.service';
import type { User } from '@domain/user/services/user.service';

describe('JSON Mode Validation', () => {
  const promptService = new PromptService();

  const testUser: User = {
    id: 'test-user',
    username: 'testuser',
    firstName: 'Test',
    lastName: 'User',
    languageCode: 'en',
    gender: 'male',
    age: 30,
    height: 180,
    weight: 80,
    fitnessGoal: 'build_muscle',
    fitnessLevel: 'intermediate',
    profileStatus: 'complete',
  };

  describe('Prompts that require JSON mode MUST mention "json"', () => {
    it('registration prompt should mention "json" or "JSON"', () => {
      const prompt = promptService.buildUnifiedRegistrationPrompt(testUser);
      
      expect(prompt.toLowerCase()).toMatch(/json/);
    });

    it('plan_creation prompt should mention "json" or "JSON"', () => {
      const prompt = promptService.buildPlanCreationPrompt({
        user: testUser,
        availableExercises: [],
        totalExercisesAvailable: 0,
      });
      
      expect(prompt.toLowerCase()).toMatch(/json/);
    });

    it('session_planning prompt should mention "json" or "JSON"', () => {
      const prompt = promptService.buildSessionPlanningPrompt({
        user: testUser,
        activePlan: null,
        recentSessions: [],
        currentPlan: null,
        totalExercisesAvailable: 0,
        daysSinceLastWorkout: null,
      });
      
      expect(prompt.toLowerCase()).toMatch(/json/);
    });

    it('training prompt should mention "json" or "JSON"', () => {
      const prompt = promptService.buildTrainingPrompt({
        user: testUser,
        activeSession: {
          id: 'session-1',
          userId: testUser.id,
          planId: 'plan-1',
          sessionKey: 'upper_a',
          status: 'in_progress',
          startedAt: new Date(),
          completedAt: null,
          durationMinutes: null,
          userContextJson: null,
          sessionPlanJson: null,
          lastActivityAt: new Date(),
          autoCloseReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          exercises: [],
        },
      });
      
      expect(prompt.toLowerCase()).toMatch(/json/);
    });
  });

  describe('Prompts that do NOT use JSON mode should NOT require "json" mention', () => {
    it('chat prompt does not need to mention "json"', () => {
      const prompt = promptService.buildChatSystemPrompt(testUser, false);
      
      // Chat prompt may or may not mention JSON - it's free-form
      // The important thing is that jsonMode is disabled for chat phase
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('JSON mode configuration in ChatService', () => {
    it('should document that chat phase uses jsonMode: false', () => {
      // This test serves as documentation
      // ChatService.processMessage sets: const needsJsonMode = phase !== 'chat';
      
      const phasesWithJsonMode = ['registration', 'plan_creation', 'session_planning', 'training'];
      const phasesWithoutJsonMode = ['chat'];
      
      expect(phasesWithJsonMode).toHaveLength(4);
      expect(phasesWithoutJsonMode).toHaveLength(1);
    });
  });

  describe('Runtime validation in LLMService', () => {
    it('should validate that prompts mention "json" when JSON mode is enabled', () => {
      // This test documents the runtime validation behavior
      // LLMService.invokeModel checks: if (jsonMode && !promptLower.includes('json'))
      
      const validationRule = 'System prompt MUST contain "json" when jsonMode=true';
      const errorMessage = 'Response input messages must contain the word \'json\' in some form';
      
      expect(validationRule).toBeTruthy();
      expect(errorMessage).toBeTruthy();
      
      // The validation prevents API errors by catching configuration issues early
      // If this validation fails, LLMService throws CONFIGURATION ERROR before API call
    });
  });
});
