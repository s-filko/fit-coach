/**
 * Integration test for data saving functionality
 * This test identifies where the data saving fails
 */

import { ProfileParserService } from '../../../src/domain/user/services/profile-parser.service';
import { RegistrationService } from '../../../src/domain/user/services/registration.service';
import { UserService } from '../../../src/domain/user/services/user.service';
import { DrizzleUserRepository } from '../../../src/infra/db/repositories/user.repository';

// Mock LLM to return consistent test data
const mockLLMService = {
  generateResponse: jest.fn().mockResolvedValue(JSON.stringify({
    age: 28,
    gender: 'male',
    height: 175,
    weight: 75,
    fitnessLevel: 'intermediate',
    fitnessGoal: 'lose weight',
  })),
};

const mockPromptService = {
  buildProfileParsingPrompt: jest.fn().mockReturnValue([
    { role: 'system', content: 'Parse user profile data from the following message. Return only valid JSON.' },
    { role: 'user', content: 'I am 28 years old male 175cm 75kg' },
  ]),
};

jest.mock('../../../src/infra/ai/llm.service', () => ({
  LLMService: jest.fn().mockImplementation(() => mockLLMService),
}));

jest.mock('../../../src/domain/user/services/prompt.service', () => ({
  PromptService: jest.fn().mockImplementation(() => mockPromptService),
}));

describe('Data Saving Integration Test', () => {
  let userService: UserService;
  let parserService: ProfileParserService;
  let registrationService: RegistrationService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock LLM to return valid JSON for parsing
    mockLLMService.generateResponse.mockResolvedValue(
      JSON.stringify({
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight',
      }),
    );

    // Initialize services
    const repository = new DrizzleUserRepository();
    userService = new UserService(repository);
    parserService = new ProfileParserService(
      mockPromptService as any,
      mockLLMService as any,
    );
    registrationService = new RegistrationService(
      parserService,
      {
        buildWelcomeMessage: jest.fn(),
        buildBasicInfoSuccessMessage: jest.fn(
          (age, gender, height, weight) => `Success: ${age}, ${gender}, ${height}, ${weight}`,
        ),
      } as any,
      mockLLMService as any,
    );
  });

  describe('Data Flow: Parser -> Registration -> Database', () => {
    it('should identify where data saving fails', async() => {
      // Step 1: Test parser separately
      console.log('\n=== STEP 1: Testing Parser ===');
      const testUser = { id: 'test-user-integration', profileStatus: 'incomplete' } as any;
      const parsedData = await parserService.parseProfileData(testUser, 'I am 28 years old male 175cm 75kg');

      console.log('Parser result:', parsedData);
      expect(parsedData.age).toBe(28);
      expect(parsedData.gender).toBe('male');
      expect(parsedData.height).toBe(175);
      expect(parsedData.weight).toBe(75);

      // Step 2: Create a test user
      console.log('\n=== STEP 2: Creating Test User ===');
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

      // Step 3: Test direct database update
      console.log('\n=== STEP 3: Testing Direct Database Update ===');
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

      // Step 4: Test registration service
      console.log('\n=== STEP 4: Testing Registration Service ===');
      const registrationResult = await registrationService.processUserMessage(
        {
          ...dbUser,
          profileStatus: 'collecting_basic',
        },
        'I am 28 years old male 175cm 75kg',
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

      // Step 5: Verify data persistence
      console.log('\n=== STEP 5: Verifying Data Persistence ===');
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
    it('should update single field in complete profile', async() => {
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

    it('should handle multiple selective field updates', async() => {
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
    it('should handle parser returning undefined values', async() => {
      // Mock parser to return undefined values
      mockLLMService.generateResponse.mockResolvedValueOnce(
        JSON.stringify({
          age: undefined,
          gender: undefined,
          height: undefined,
          weight: undefined,
          fitnessLevel: undefined,
          fitnessGoal: undefined,
        }),
      );

      const dbUser = await userService.upsertUser({
        provider: 'telegram',
        providerUserId: 'error_test_' + Date.now(),
        username: 'error_test',
        firstName: 'Error',
        lastName: 'Test',
      });

      const registrationResult = await registrationService.processUserMessage(
        { ...dbUser, profileStatus: 'collecting_basic' },
        'some invalid message',
      );

      // Should handle gracefully without crashing
      expect(registrationResult).toBeDefined();
      expect(registrationResult.updatedUser).toBeDefined();
    });

    it('should handle database update failures', async() => {
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
