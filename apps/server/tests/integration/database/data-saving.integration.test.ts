/**
 * Integration test for data saving functionality
 * This test identifies where the data saving fails
 */

import { RegistrationService } from '../../../src/domain/user/services/registration.service';
import { UserService } from '../../../src/domain/user/services/user.service';
import { DrizzleUserRepository } from '../../../src/infra/db/repositories/user.repository';

// Mock LLM returns unified JSON format (extracted_data + response + is_confirmed)
const mockLLMService = {
  generateResponse: jest.fn().mockResolvedValue('Mock AI response'),
  generateRegistrationResponse: jest.fn().mockResolvedValue('Mock AI response'),
  generateWithSystemPrompt: jest.fn().mockResolvedValue(JSON.stringify({
    extracted_data: {
      age: 28,
      gender: 'male',
      height: 175,
      weight: 75,
      fitnessLevel: 'intermediate',
      fitnessGoal: 'lose weight',
    },
    response: 'Great! I have all your info. Please confirm.',
    is_confirmed: false,
  })),
  getDebugInfo: jest.fn().mockReturnValue({}),
  enableDebugMode: jest.fn(),
  disableDebugMode: jest.fn(),
  clearHistory: jest.fn(),
};

const mockPromptService = {
  buildUnifiedRegistrationPrompt: jest.fn().mockReturnValue('mock system prompt'),
  buildChatSystemPrompt: jest.fn().mockReturnValue('mock chat prompt'),
};

describe('Data Saving Integration Test', () => {
  let userService: UserService;
  let registrationService: RegistrationService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset LLM mock to default unified JSON response
    mockLLMService.generateWithSystemPrompt.mockResolvedValue(JSON.stringify({
      extracted_data: {
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight',
      },
      response: 'Great! I have all your info. Please confirm.',
      is_confirmed: false,
    }));

    // Initialize services
    const repository = new DrizzleUserRepository();
    userService = new UserService(repository);
    registrationService = new RegistrationService(
      mockPromptService as any,
      mockLLMService as any,
    );
  });

  describe('Data Flow: LLM -> Registration -> Database', () => {
    it('should extract data from unified LLM response and update user', async () => {
      // Step 1: Create a test user
      console.log('\n=== STEP 1: Creating Test User ===');
      const dbUser = await userService.upsertUser({
        provider: 'telegram',
        providerUserId: 'integration_test_' + Date.now(),
        username: 'integration_test',
        firstName: 'Integration',
        lastName: 'Test',
        languageCode: 'en',
      });

      console.log('Created user:', dbUser.id);
      expect(dbUser).toBeDefined();
      expect(dbUser.id).toBeDefined();

      // Step 2: Test direct database update
      console.log('\n=== STEP 2: Testing Direct Database Update ===');
      const directUpdateResult = await userService.updateProfileData(dbUser.id, {
        age: 28,
        gender: 'male' as const,
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate' as const,
        fitnessGoal: 'lose weight',
      });

      console.log('Direct update result:', directUpdateResult);

      if (directUpdateResult) {
        expect(directUpdateResult.age).toBe(28);
        expect(directUpdateResult.gender).toBe('male');
        expect(directUpdateResult.height).toBe(175);
        expect(directUpdateResult.weight).toBe(75);
      } else {
        console.error('❌ Direct database update failed!');
        fail('Direct database update should succeed');
      }

      // Step 3: Test registration service with unified LLM
      console.log('\n=== STEP 3: Testing Registration Service ===');
      const registrationResult = await registrationService.processUserMessage(
        { ...dbUser, profileStatus: 'registration' },
        'I am 28 years old male 175cm 75kg intermediate lose weight',
      );

      console.log('Registration result:', {
        updatedUser: registrationResult.updatedUser,
        response: registrationResult.response,
        isComplete: registrationResult.isComplete,
      });

      expect(registrationResult.updatedUser.age).toBe(28);
      expect(registrationResult.updatedUser.gender).toBe('male');
      expect(registrationResult.updatedUser.height).toBe(175);
      expect(registrationResult.updatedUser.weight).toBe(75);
      expect(registrationResult.updatedUser.fitnessLevel).toBe('intermediate');
      expect(registrationResult.updatedUser.fitnessGoal).toBe('lose weight');

      // Step 4: Verify data persistence
      console.log('\n=== STEP 4: Verifying Data Persistence ===');
      const retrievedUser = await userService.getUser(dbUser.id);

      console.log('Retrieved user from DB:', retrievedUser);

      if (retrievedUser) {
        expect(retrievedUser.age).toBe(28);
        expect(retrievedUser.gender).toBe('male');
        expect(retrievedUser.height).toBe(175);
        expect(retrievedUser.weight).toBe(75);
        expect(retrievedUser.fitnessLevel).toBe('intermediate');
        expect(retrievedUser.fitnessGoal).toBe('lose weight');
      } else {
        console.error('❌ User not found in database after update!');
        fail('User should be retrievable from database');
      }
    });
  });

  describe('Partial Updates', () => {
    it('should update single field in complete profile', async () => {
      // Create and populate user profile
      const dbUser = await userService.upsertUser({
        provider: 'telegram',
        providerUserId: 'partial_update_' + Date.now(),
        username: 'partial_test',
        firstName: 'Partial',
        lastName: 'Update',
      });

      // First, populate the profile completely
      await userService.updateProfileData(dbUser.id, {
        age: 25,
        gender: 'female' as const,
        height: 170,
        weight: 65,
        fitnessLevel: 'intermediate' as const,
        fitnessGoal: 'lose weight',
      });

      // Verify profile is complete
      const populatedUser = await userService.getUser(dbUser.id);
      expect(populatedUser?.age).toBe(25);
      expect(populatedUser?.gender).toBe('female');
      expect(populatedUser?.height).toBe(170);

      // Now update only ONE field
      const partialUpdateResult = await userService.updateProfileData(dbUser.id, {
        age: 26,  // Change only age from 25 to 26
      });

      expect(partialUpdateResult).toBeDefined();
      expect(partialUpdateResult!.age).toBe(26);
      // Other fields should remain unchanged
      expect(partialUpdateResult!.gender).toBe('female');
      expect(partialUpdateResult!.height).toBe(170);
      expect(partialUpdateResult!.weight).toBe(65);
      expect(partialUpdateResult!.fitnessLevel).toBe('intermediate');
      expect(partialUpdateResult!.fitnessGoal).toBe('lose weight');

      console.log('✅ Partial update successful - only age changed from 25 to 26');
    });

    it('should handle multiple selective field updates', async () => {
      const dbUser = await userService.upsertUser({
        provider: 'telegram',
        providerUserId: 'selective_update_' + Date.now(),
        username: 'selective_test',
        firstName: 'Selective',
        lastName: 'Update',
      });

      // Populate profile
      await userService.updateProfileData(dbUser.id, {
        age: 30,
        gender: 'male' as const,
        height: 180,
        weight: 80,
        fitnessLevel: 'advanced' as const,
        fitnessGoal: 'build muscle',
      });

      // Update multiple fields selectively
      const selectiveUpdateResult = await userService.updateProfileData(dbUser.id, {
        age: 31,
        fitnessGoal: 'maintain fitness',
        // gender, height, weight, fitnessLevel are NOT included
      });

      expect(selectiveUpdateResult).toBeDefined();
      expect(selectiveUpdateResult!.age).toBe(31);
      expect(selectiveUpdateResult!.fitnessGoal).toBe('maintain fitness');
      // Unchanged fields should remain the same
      expect(selectiveUpdateResult!.gender).toBe('male');
      expect(selectiveUpdateResult!.height).toBe(180);
      expect(selectiveUpdateResult!.weight).toBe(80);
      expect(selectiveUpdateResult!.fitnessLevel).toBe('advanced');

      console.log('✅ Selective update successful - age and fitnessGoal changed, others unchanged');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle LLM returning invalid JSON gracefully', async () => {
      // Mock LLM to return non-JSON response
      mockLLMService.generateWithSystemPrompt.mockResolvedValueOnce('This is not valid JSON at all');

      const dbUser = await userService.upsertUser({
        provider: 'telegram',
        providerUserId: 'error_test_' + Date.now(),
        username: 'error_test',
        firstName: 'Error',
        lastName: 'Test',
      });

      const registrationResult = await registrationService.processUserMessage(
        { ...dbUser, profileStatus: 'registration' },
        'some message',
      );

      // Should handle gracefully without crashing — returns fallback response
      expect(registrationResult).toBeDefined();
      expect(registrationResult.updatedUser).toBeDefined();
      expect(registrationResult.isComplete).toBe(false);
      expect(registrationResult.response).toContain('trouble processing');
    });

    it('should handle LLM returning null fields without overwriting existing data', async () => {
      // Mock LLM to return nulls for all fields
      mockLLMService.generateWithSystemPrompt.mockResolvedValueOnce(JSON.stringify({
        extracted_data: {
          age: null,
          gender: null,
          height: null,
          weight: null,
          fitnessLevel: null,
          fitnessGoal: null,
        },
        response: 'Could you tell me more about yourself?',
        is_confirmed: false,
      }));

      const userWithData = {
        id: 'test-user',
        profileStatus: 'registration',
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: undefined,
        fitnessGoal: undefined,
      };

      const registrationResult = await registrationService.processUserMessage(
        userWithData as any,
        'some invalid message',
      );

      // Existing data should NOT be overwritten with nulls
      expect(registrationResult.updatedUser.age).toBe(28);
      expect(registrationResult.updatedUser.gender).toBe('male');
      expect(registrationResult.updatedUser.height).toBe(175);
      expect(registrationResult.updatedUser.weight).toBe(75);
      expect(registrationResult.isComplete).toBe(false);
    });

    it('should handle database update failures', async () => {
      const dbUser = await userService.upsertUser({
        provider: 'telegram',
        providerUserId: 'failure_test_' + Date.now(),
        username: 'failure_test',
        firstName: 'Failure',
        lastName: 'Test',
      });

      // This should succeed even if previous operations failed
      const result = await userService.getUser(dbUser.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(dbUser.id);
    });
  });
});
