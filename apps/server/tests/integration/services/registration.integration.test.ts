import { RegistrationService } from '../../../src/domain/user/services/registration.service';

// Mock classes for testing
class MockProfileParserService {
  parseProfileData = jest.fn();
  parseUniversal = jest.fn();
  validateFieldValue = jest.fn();
  validateAge = jest.fn();
  validateGender = jest.fn();
  validateHeight = jest.fn();
  validateWeight = jest.fn();
  validateFitnessLevel = jest.fn();
  validateFitnessGoal = jest.fn();
}

class MockUserService {
  upsertUser = jest.fn();
  getUser = jest.fn();
  updateProfileData = jest.fn();
  isRegistrationComplete = jest.fn();
  needsRegistration = jest.fn();
  getCurrentRegistrationStep = jest.fn();
  getNextRegistrationStep = jest.fn();
}

class MockPromptService {
  buildWelcomeMessage = jest.fn(() => 'Welcome message');
  buildBasicInfoSuccessMessage = jest.fn(() => 'Basic info success');
  buildFitnessLevelSuccessMessage = jest.fn(() => 'Fitness level success');
  buildGoalsSuccessMessage = jest.fn(() => 'Goals success');
  buildRegistrationCompleteMessage = jest.fn(() => 'Registration complete');
  buildClarificationMessage = jest.fn(() => 'Clarification message');
  buildProfileResetMessage = jest.fn(() => 'Profile reset message');
  buildConfirmationNeededMessage = jest.fn(() => 'Confirmation needed');
  buildClarificationPrompt = jest.fn(() => 'Clarification prompt');
  buildInvalidFieldsMessage = jest.fn((fields: string[]) => `Please correct: ${fields.join(', ')}`);
  buildRegistrationContext = jest.fn((u: {
    age?: number; gender?: string; height?: number; weight?: number;
    fitnessLevel?: string; fitnessGoal?: string; profileStatus?: string;
  }) => {
    const parts = [u.age != null && `age=${u.age}`, u.gender && `gender=${u.gender}`,
      u.height != null && `height=${u.height}`, u.weight != null && `weight=${u.weight}`];
    return `Already: ${parts.filter(Boolean).join(', ')}.`;
  });
  buildReaskBasicInfoMessage = jest.fn((u: { age?: number; gender?: string; height?: number; weight?: number }) =>
    `I already have: ${[u.age != null && `Age ${u.age}`, u.gender && `Gender ${u.gender}`, u.height != null && `Height ${u.height}`, u.weight != null && `Weight ${u.weight}`].filter(Boolean).join(', ')}. What is your gender?`,
  );
}

describe('RegistrationService Integration', () => {
  let registrationService: RegistrationService;
  let mockParser: MockProfileParserService;
  let mockUserService: MockUserService;
  let mockPromptService: MockPromptService;

  beforeEach(() => {
    mockParser = new MockProfileParserService();
    mockUserService = new MockUserService();
    mockPromptService = new MockPromptService();

    registrationService = new RegistrationService(
      mockParser as any,
      mockPromptService as any,
      {
        generateResponse: jest.fn().mockResolvedValue('Mock AI response'),
        generateRegistrationResponse: jest.fn().mockResolvedValue('Mock AI response'),
      } as any,
    );
  });

  describe('complete registration flow', () => {
    const testUser = {
      id: 'test-user-id',
      profileStatus: 'incomplete',
      age: undefined,
      gender: undefined,
      height: undefined,
      weight: undefined,
      fitnessLevel: undefined,
      fitnessGoal: undefined,
    };

    it('should handle basic info collection', async() => {
      // Mock parsed data
      const parsedData = {
        age: 28,
        gender: 'male' as const,
        height: 175,
        weight: 75,
        fitnessLevel: undefined,
        fitnessGoal: undefined,
      };

      mockParser.parseProfileData.mockResolvedValue(parsedData);

      const result = await registrationService.processUserMessage(testUser, 'I am 28 years old male 175cm 75kg');

      expect(result.updatedUser.profileStatus).toBe('collecting_basic'); // First message from incomplete user triggers greeting
      // Note: handleGreeting doesn't process parsed data, only changes status
      expect(result.updatedUser.age).toBeUndefined();
      expect(result.updatedUser.gender).toBeUndefined();
      expect(result.updatedUser.height).toBeUndefined();
      expect(result.updatedUser.weight).toBeUndefined();
      expect(mockParser.parseProfileData).toHaveBeenCalledWith(testUser, 'I am 28 years old male 175cm 75kg');
      expect(result.isComplete).toBe(false);
    });

    it('should handle fitness level collection', async() => {
      const userWithBasicInfo = {
        ...testUser,
        profileStatus: 'collecting_level',
        age: 28,
        gender: 'male' as const,
        height: 175,
        weight: 75,
      };

      const parsedData = {
        age: undefined,
        gender: undefined,
        height: undefined,
        weight: undefined,
        fitnessLevel: 'intermediate' as const,
        fitnessGoal: undefined,
      };

      mockParser.parseProfileData.mockResolvedValue(parsedData);
      mockUserService.updateProfileData.mockResolvedValue({
        ...userWithBasicInfo,
        profileStatus: 'collecting_goals',
        fitnessLevel: 'intermediate',
      });

      const result = await registrationService.processUserMessage(userWithBasicInfo, 'intermediate level');

      expect(result.updatedUser.profileStatus).toBe('collecting_goals');
      expect(result.updatedUser.fitnessLevel).toBe('intermediate');
      expect(result.isComplete).toBe(false);
    });

    it('should handle fitness goals collection', async() => {
      const userWithLevel = {
        ...testUser,
        profileStatus: 'collecting_goals',
        age: 28,
        gender: 'male' as const,
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate' as const,
      };

      const parsedData = {
        age: undefined,
        gender: undefined,
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: 'lose weight',
      };

      mockParser.parseProfileData.mockResolvedValue(parsedData);
      mockUserService.updateProfileData.mockResolvedValue({
        ...userWithLevel,
        profileStatus: 'confirmation',
        fitnessGoal: 'lose weight',
      });

      const result = await registrationService.processUserMessage(userWithLevel, 'I want to lose weight');

      expect(result.updatedUser.profileStatus).toBe('confirmation');
      expect(result.updatedUser.fitnessGoal).toBe('lose weight');
      expect(result.isComplete).toBe(false);
    });

    it('should complete registration when all data is available', async() => {
      const userWithAllData = {
        ...testUser,
        profileStatus: 'confirmation',
        age: 28,
        gender: 'male' as const,
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate' as const,
        fitnessGoal: 'lose weight',
      };

      mockParser.parseProfileData.mockResolvedValue({
        age: undefined,
        gender: undefined,
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: undefined,
      });

      mockUserService.updateProfileData.mockResolvedValue({
        ...userWithAllData,
        profileStatus: 'complete',
      });

      const result = await registrationService.processUserMessage(userWithAllData, 'yes');

      expect(result.updatedUser.profileStatus).toBe('complete');
      expect(result.isComplete).toBe(true);
    });

    it('should prevent completion when data is missing', async() => {
      const userWithMissingData = {
        ...testUser,
        profileStatus: 'confirmation',
        age: 28,
        gender: 'male' as const,
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate' as const,
        fitnessGoal: undefined, // Missing goal
      };

      mockParser.parseProfileData.mockResolvedValue({
        age: undefined,
        gender: undefined,
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: undefined,
      });

      const result = await registrationService.processUserMessage(userWithMissingData, 'yes');

      expect(result.updatedUser.profileStatus).toBe('confirmation'); // Should not change
      expect(result.isComplete).toBe(false);
      expect(result.response).toBe('Mock AI response'); // AI response for confirmation with missing data
    });
  });

  describe('error handling', () => {
    const testUser = {
      id: 'test-user-id',
      profileStatus: 'incomplete' as const,
      age: undefined,
      gender: undefined,
      height: undefined,
      weight: undefined,
      fitnessLevel: undefined,
      fitnessGoal: undefined,
    };

    it('should handle parser errors gracefully', async() => {
      // Simulate parser returning undefined values (error case)
      mockParser.parseProfileData.mockResolvedValue({
        age: undefined,
        gender: undefined,
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: undefined,
      });

      const result = await registrationService.processUserMessage(testUser, 'some message');

      // Even with parser error, handleGreeting still changes status to 'collecting_basic'
      expect(result.updatedUser.profileStatus).toBe('collecting_basic');
      expect(result.updatedUser.age).toBeUndefined();
      expect(result.updatedUser.gender).toBeUndefined();
      expect(result.isComplete).toBe(false);
    });

    it('should handle user service errors gracefully', async() => {
      // Use user with 'collecting_basic' status to test handleBasicInfo
      const userWithBasicStatus = {
        ...testUser,
        profileStatus: 'collecting_basic' as const,
      };

      mockParser.parseProfileData.mockResolvedValue({
        age: 25,
        gender: 'female' as const,
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: undefined,
      });

      const result = await registrationService.processUserMessage(userWithBasicStatus, 'I am 25 female');

      // handleBasicInfo should process partial data
      expect(result.updatedUser.age).toBe(25);
      expect(result.updatedUser.gender).toBe('female');
      expect(result.updatedUser.profileStatus).toBe('collecting_basic'); // Status stays the same
      expect(result.isComplete).toBe(false);
    });

    it('happy path: user provides all basic info in one message → profile updated, success message, next step', async() => {
      const userWithBasicStatus = {
        ...testUser,
        profileStatus: 'collecting_basic' as const,
      };

      mockParser.parseProfileData.mockResolvedValue({
        age: 30,
        gender: 'male' as const,
        height: 178,
        weight: 74,
        fitnessLevel: undefined,
        fitnessGoal: undefined,
      });

      mockPromptService.buildBasicInfoSuccessMessage.mockReturnValue('Great! Now, what is your fitness level?');

      const russianMessage = 'мне 30 лет, я мужчина, рост 178, вес 74';
      const result = await registrationService.processUserMessage(userWithBasicStatus, russianMessage);

      // Parser was called with user and message
      expect(mockParser.parseProfileData).toHaveBeenCalledWith(userWithBasicStatus, russianMessage);

      // User profile updated with all basic fields
      expect(result.updatedUser.age).toBe(30);
      expect(result.updatedUser.gender).toBe('male');
      expect(result.updatedUser.height).toBe(178);
      expect(result.updatedUser.weight).toBe(74);

      // Moved to next step (fitness level), registration not complete yet
      expect(result.updatedUser.profileStatus).toBe('collecting_level');
      expect(result.isComplete).toBe(false);

      // Success message built with extracted data and returned to user
      expect(mockPromptService.buildBasicInfoSuccessMessage).toHaveBeenCalledWith(30, 'male', 178, 74);
      expect(result.response).toBe('Great! Now, what is your fitness level?');
    });
  });
});
