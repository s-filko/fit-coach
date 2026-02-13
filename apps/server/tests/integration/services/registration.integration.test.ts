import { RegistrationService } from '../../../src/domain/user/services/registration.service';

// Mock LLM Service — returns unified JSON (extracted_data + response + is_confirmed)
class MockLLMService {
  generateResponse = jest.fn().mockResolvedValue('Mock AI response');
  generateRegistrationResponse = jest.fn().mockResolvedValue('Mock AI response');
  generateWithSystemPrompt = jest.fn();
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
          toPhase: 'session_planning',
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
        toPhase: 'session_planning',
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
          toPhase: 'session_planning',
          reason: 'user_wants_to_start_immediately',
        },
      }));

      const result = await registrationService.processUserMessage(
        userWithAllData as any,
        'yes, let\'s start training now!',
      );

      expect(result.isComplete).toBe(true);
      expect(result.phaseTransition).toEqual({
        toPhase: 'session_planning',
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
          height: 300, // Too high (max 220)
          weight: 10, // Too low (min 30)
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
