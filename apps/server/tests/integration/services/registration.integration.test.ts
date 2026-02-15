import { RegistrationService } from '../../../src/domain/user/services/registration.service';

// Mock LLM Service — returns unified JSON (extracted_data + response + is_confirmed)
class MockLLMService {
  generateResponse = jest.fn().mockResolvedValue('Mock AI response');
  generateRegistrationResponse = jest.fn().mockResolvedValue('Mock AI response');
  generateWithSystemPrompt = jest.fn();
  generateStructured = jest.fn();
  getDebugInfo = jest.fn().mockReturnValue({});
  enableDebugMode = jest.fn();
  disableDebugMode = jest.fn();
  clearHistory = jest.fn();
}

class MockPromptService {
  buildUnifiedRegistrationPrompt = jest.fn().mockReturnValue('mock system prompt');
  buildChatSystemPrompt = jest.fn().mockReturnValue('mock chat prompt');
}

describe('RegistrationService Integration', () => {
  let registrationService: RegistrationService;
  let mockLLM: MockLLMService;
  let mockPromptService: MockPromptService;

  beforeEach(() => {
    mockLLM = new MockLLMService();
    mockPromptService = new MockPromptService();

    registrationService = new RegistrationService(
      mockPromptService as any,
      mockLLM as any,
    );
  });

  describe('unified registration flow', () => {
    const baseUser = {
      id: 'test-user-id',
      profileStatus: 'registration',
      age: undefined,
      gender: undefined,
      height: undefined,
      weight: undefined,
      fitnessLevel: undefined,
      fitnessGoal: undefined,
    };

    it('should extract multiple fields from a single message', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: 28,
          gender: 'male',
          height: 175,
          weight: 75,
          fitnessLevel: null,
          fitnessGoal: null,
        },
        response: 'Got it! What is your fitness level?',
        is_confirmed: false,
      }));

      const result = await registrationService.processUserMessage(
        baseUser as any,
        'I am 28 years old male 175cm 75kg',
      );

      // All 4 fields should be extracted from one message
      expect(result.updatedUser.age).toBe(28);
      expect(result.updatedUser.gender).toBe('male');
      expect(result.updatedUser.height).toBe(175);
      expect(result.updatedUser.weight).toBe(75);
      expect(result.updatedUser.fitnessLevel).toBeUndefined();
      expect(result.updatedUser.fitnessGoal).toBeUndefined();
      expect(result.isComplete).toBe(false);
      expect(result.response).toBe('Got it! What is your fitness level?');

      // Prompt was built with user state
      expect(mockPromptService.buildUnifiedRegistrationPrompt).toHaveBeenCalledWith(baseUser);
    });

    it('should pass conversation history to LLM', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: { age: 30, gender: null, height: null, weight: null, fitnessLevel: null, fitnessGoal: null },
        response: 'What is your gender?',
        is_confirmed: false,
      }));

      const historyMessages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Welcome! Tell me about yourself.' },
      ];

      await registrationService.processUserMessage(
        baseUser as any,
        'I am 30 years old',
        historyMessages,
      );

      // LLM should receive history + current message
      expect(mockLLM.generateWithSystemPrompt).toHaveBeenCalledWith(
        [
          ...historyMessages,
          { role: 'user', content: 'I am 30 years old' },
        ],
        'mock system prompt',
        { jsonMode: true },
      );
    });

    it('should complete registration when all fields present and user confirms', async () => {
      const userWithAllData = {
        ...baseUser,
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight',
      };

      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: null, gender: null, height: null, weight: null,
          fitnessLevel: null, fitnessGoal: null,
        },
        response: 'Your profile is complete! Let\'s get started.',
        is_confirmed: true,
      }));

      const result = await registrationService.processUserMessage(
        userWithAllData as any,
        'yes, confirmed',
      );

      expect(result.updatedUser.profileStatus).toBe('complete');
      expect(result.isComplete).toBe(true);
      expect(result.response).toContain('profile is complete');
    });

    it('should NOT complete when user confirms but fields are missing', async () => {
      const userWithMissingGoal = {
        ...baseUser,
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: undefined, // Missing!
      };

      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: null, gender: null, height: null, weight: null,
          fitnessLevel: null, fitnessGoal: null,
        },
        response: 'Almost there! What is your fitness goal?',
        is_confirmed: true, // User said "yes" but goal is still missing
      }));

      const result = await registrationService.processUserMessage(
        userWithMissingGoal as any,
        'yes',
      );

      // Should NOT be complete because fitnessGoal is missing
      expect(result.isComplete).toBe(false);
      expect(result.updatedUser.profileStatus).toBe('registration');
    });

    it('should allow updating fields after seeing summary', async () => {
      const userWithAllData = {
        ...baseUser,
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight',
      };

      // User wants to change age
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: 30, // Updated age
          gender: null, height: null, weight: null,
          fitnessLevel: null, fitnessGoal: null,
        },
        response: 'Updated your age to 30. Everything else looks good?',
        is_confirmed: false,
      }));

      const result = await registrationService.processUserMessage(
        userWithAllData as any,
        'actually I am 30',
      );

      expect(result.updatedUser.age).toBe(30);
      expect(result.updatedUser.gender).toBe('male'); // Unchanged
      expect(result.isComplete).toBe(false); // Not confirmed yet
    });

    it('should extract all 6 fields and complete in one message', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: 25,
          gender: 'female',
          height: 165,
          weight: 55,
          fitnessLevel: 'beginner',
          fitnessGoal: 'get fit',
        },
        response: 'All set! Your profile is ready.',
        is_confirmed: true,
      }));

      const result = await registrationService.processUserMessage(
        baseUser as any,
        'I am 25 female 165cm 55kg beginner, I want to get fit, confirmed',
      );

      expect(result.updatedUser.age).toBe(25);
      expect(result.updatedUser.gender).toBe('female');
      expect(result.updatedUser.height).toBe(165);
      expect(result.updatedUser.weight).toBe(55);
      expect(result.updatedUser.fitnessLevel).toBe('beginner');
      expect(result.updatedUser.fitnessGoal).toBe('get fit');
      expect(result.updatedUser.profileStatus).toBe('complete');
      expect(result.isComplete).toBe(true);
    });

    it('should accept decimal weight values (e.g., 72.5 kg)', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: 30,
          gender: 'male',
          height: 180,
          weight: 72.5,
          fitnessLevel: 'intermediate',
          fitnessGoal: 'build muscle',
        },
        response: 'Perfect! All data saved.',
        is_confirmed: true,
        phaseTransition: {
          toPhase: 'plan_creation',
          reason: 'user_ready_to_train',
        },
      }));

      const result = await registrationService.processUserMessage(
        baseUser as any,
        'I am 30 male 180cm 72.5kg intermediate, want to build muscle',
      );

      expect(result.updatedUser.weight).toBe(72.5);
      expect(result.updatedUser.age).toBe(30);
      expect(result.updatedUser.gender).toBe('male');
      expect(result.updatedUser.height).toBe(180);
      expect(result.updatedUser.fitnessLevel).toBe('intermediate');
      expect(result.updatedUser.fitnessGoal).toBe('build muscle');
      expect(result.updatedUser.profileStatus).toBe('complete');
      expect(result.isComplete).toBe(true);
      expect(result.phaseTransition).toEqual({
        toPhase: 'plan_creation',
        reason: 'user_ready_to_train',
      });
    });

    it('should transition to session_planning when user wants to start training', async () => {
      const userWithAllData = {
        ...baseUser,
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight',
      };

      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: null, gender: null, height: null, weight: null,
          fitnessLevel: null, fitnessGoal: null,
        },
        response: 'Great! Let\'s plan your first workout.',
        is_confirmed: true,
        phaseTransition: {
          toPhase: 'plan_creation',
          reason: 'user_wants_to_start_immediately',
        },
      }));

      const result = await registrationService.processUserMessage(
        userWithAllData as any,
        'yes, let\'s start training now!',
      );

      expect(result.isComplete).toBe(true);
      expect(result.phaseTransition).toEqual({
        toPhase: 'plan_creation',
        reason: 'user_wants_to_start_immediately',
      });
    });

    it('should transition to chat when user wants to chat first', async () => {
      const userWithAllData = {
        ...baseUser,
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight',
      };

      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: null, gender: null, height: null, weight: null,
          fitnessLevel: null, fitnessGoal: null,
        },
        response: 'Sure! What would you like to know?',
        is_confirmed: true,
        phaseTransition: {
          toPhase: 'chat',
          reason: 'user_wants_to_chat_first',
        },
      }));

      const result = await registrationService.processUserMessage(
        userWithAllData as any,
        'yes, but I have some questions first',
      );

      expect(result.isComplete).toBe(true);
      expect(result.phaseTransition).toEqual({
        toPhase: 'chat',
        reason: 'user_wants_to_chat_first',
      });
    });

    it('should accept decimal height values and keep precision', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: 25,
          gender: 'female',
          height: 165.5,
          weight: 58.3,
          fitnessLevel: 'beginner',
          fitnessGoal: 'get fit',
        },
        response: 'All set!',
        is_confirmed: true,
        phaseTransition: {
          toPhase: 'plan_creation',
        },
      }));

      const result = await registrationService.processUserMessage(
        baseUser as any,
        'I am 25 female 165.5cm 58.3kg beginner',
      );

      expect(result.updatedUser.height).toBe(165.5);
      expect(result.updatedUser.weight).toBe(58.3);
      expect(result.isComplete).toBe(true);
    });

    it('should round decimal age to nearest integer', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: 29.7,
          gender: 'male',
          height: 178.2,
          weight: 82.5,
          fitnessLevel: 'intermediate',
          fitnessGoal: 'build muscle',
        },
        response: 'Perfect!',
        is_confirmed: true,
        phaseTransition: {
          toPhase: 'plan_creation',
        },
      }));

      const result = await registrationService.processUserMessage(
        baseUser as any,
        'I am 29.7 years old male 178.2cm 82.5kg',
      );

      // Age should be rounded: 29.7 → 30
      expect(result.updatedUser.age).toBe(30);
      // Height and weight should keep precision
      expect(result.updatedUser.height).toBe(178.2);
      expect(result.updatedUser.weight).toBe(82.5);
    });

    it('should round age 24.4 down to 24', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: 24.4,
          gender: 'female',
          height: 160,
          weight: 55,
          fitnessLevel: 'beginner',
          fitnessGoal: 'lose weight',
        },
        response: 'Great!',
        is_confirmed: true,
        phaseTransition: {
          toPhase: 'plan_creation',
        },
      }));

      const result = await registrationService.processUserMessage(
        baseUser as any,
        'I am 24.4 years old',
      );

      // Age should be rounded down: 24.4 → 24
      expect(result.updatedUser.age).toBe(24);
    });
  });

  describe('error handling', () => {
    const testUser = {
      id: 'test-user-id',
      profileStatus: 'registration',
      age: undefined,
      gender: undefined,
      height: undefined,
      weight: undefined,
      fitnessLevel: undefined,
      fitnessGoal: undefined,
    };

    it('should handle invalid JSON from LLM gracefully', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue('not valid json at all');

      const result = await registrationService.processUserMessage(testUser as any, 'hello');

      expect(result.updatedUser).toBeDefined();
      expect(result.isComplete).toBe(false);
      expect(result.response).toContain('trouble processing');
    });

    it('should handle LLM throwing an error gracefully', async () => {
      mockLLM.generateWithSystemPrompt.mockRejectedValue(new Error('LLM API error'));

      const result = await registrationService.processUserMessage(testUser as any, 'hello');

      expect(result.updatedUser).toBeDefined();
      expect(result.isComplete).toBe(false);
      expect(result.response).toContain('trouble processing');
    });

    it('should handle markdown-wrapped JSON from LLM', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue('```json\n' + JSON.stringify({
        extracted_data: { age: 25, gender: null, height: null, weight: null, fitnessLevel: null, fitnessGoal: null },
        response: 'Got your age!',
        is_confirmed: false,
      }) + '\n```');

      const result = await registrationService.processUserMessage(testUser as any, 'I am 25');

      expect(result.updatedUser.age).toBe(25);
      expect(result.response).toBe('Got your age!');
      expect(result.isComplete).toBe(false);
    });

    it('should reject invalid field values via Zod validators', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: 5, // Too low (min 10)
          gender: 'unknown', // Not male/female
          height: 300, // Too high (max 250)
          weight: 10, // Too low (min 20)
          fitnessLevel: 'pro', // Not a valid level
          fitnessGoal: 'get fit',
        },
        response: 'Let me check those values...',
        is_confirmed: false,
      }));

      const result = await registrationService.processUserMessage(testUser as any, 'some data');

      // Invalid fields should be filtered out, only valid fitnessGoal passes
      expect(result.updatedUser.age).toBeUndefined();
      expect(result.updatedUser.gender).toBeUndefined();
      expect(result.updatedUser.height).toBeUndefined();
      expect(result.updatedUser.weight).toBeUndefined();
      expect(result.updatedUser.fitnessLevel).toBeUndefined();
      expect(result.updatedUser.fitnessGoal).toBe('get fit');
      expect(result.isComplete).toBe(false);
    });

    it('should reject extreme invalid values', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: 1000, // Way too old
          gender: 'male',
          height: 500, // Impossible height
          weight: 500, // Impossible weight
          fitnessLevel: 'beginner',
          fitnessGoal: 'get fit',
        },
        response: 'Those values seem incorrect...',
        is_confirmed: false,
      }));

      const result = await registrationService.processUserMessage(testUser as any, 'I am 1000 years old');

      // Invalid numeric fields should be rejected
      expect(result.updatedUser.age).toBeUndefined();
      expect(result.updatedUser.height).toBeUndefined();
      expect(result.updatedUser.weight).toBeUndefined();
      // Valid fields should pass
      expect(result.updatedUser.gender).toBe('male');
      expect(result.updatedUser.fitnessLevel).toBe('beginner');
      expect(result.updatedUser.fitnessGoal).toBe('get fit');
    });

    it('should accept edge case minimum values', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: 10,      // Min age
          gender: 'female',
          height: 100.5,  // Min height + decimal
          weight: 20.5,   // Min weight + decimal
          fitnessLevel: 'beginner',
          fitnessGoal: 'get fit',
        },
        response: 'All set!',
        is_confirmed: true,
        phaseTransition: {
          toPhase: 'plan_creation',
        },
      }));

      const result = await registrationService.processUserMessage(testUser as any, 'I am 10 years old');

      expect(result.updatedUser.age).toBe(10);
      expect(result.updatedUser.height).toBe(100.5);
      expect(result.updatedUser.weight).toBe(20.5);
      expect(result.isComplete).toBe(true);
    });

    it('should accept edge case maximum values', async () => {
      mockLLM.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
        extracted_data: {
          age: 120,     // Max age
          gender: 'male',
          height: 250,  // Max height
          weight: 300,  // Max weight
          fitnessLevel: 'beginner',
          fitnessGoal: 'stay healthy',
        },
        response: 'Impressive!',
        is_confirmed: true,
        phaseTransition: {
          toPhase: 'plan_creation',
        },
      }));

      const result = await registrationService.processUserMessage(testUser as any, 'I am very tall');

      expect(result.updatedUser.age).toBe(120);
      expect(result.updatedUser.height).toBe(250);
      expect(result.updatedUser.weight).toBe(300);
      expect(result.isComplete).toBe(true);
    });
  });

  describe('checkProfileCompleteness', () => {
    it('should return true when all fields present and status is complete', () => {
      const completeUser = {
        id: 'test',
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight',
        profileStatus: 'complete',
      };

      expect(registrationService.checkProfileCompleteness(completeUser as any)).toBe(true);
    });

    it('should return false when fields are missing', () => {
      const incompleteUser = {
        id: 'test',
        age: 28,
        gender: 'male',
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: undefined,
        profileStatus: 'registration',
      };

      expect(registrationService.checkProfileCompleteness(incompleteUser as any)).toBe(false);
    });
  });
});
