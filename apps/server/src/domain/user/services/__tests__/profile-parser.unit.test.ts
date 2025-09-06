import { ProfileParserService } from '../profile-parser.service';

/**
 * ProfileParserService Unit Tests
 * Tests parsing logic with mocked LLM responses
 */
describe('ProfileParserService – parsing logic unit', () => {
  let parserService: ProfileParserService;

  beforeEach(() => {
    // Create fresh service instance for each test
    const mockPromptService = { buildDataParsingPromptWithAnswers: jest.fn() };
    const mockLLMService = { generateResponse: jest.fn() };

    parserService = new ProfileParserService(
      mockPromptService as any,
      mockLLMService as any,
    );
  });

  describe('parseProfileData with mock responses', () => {
    it('should parse complete profile data correctly', async() => {
      // Arrange
      const mockLLMResponse = JSON.stringify({
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight',
      });

      const mockPromptMessages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' },
      ];

      const mockPromptService = {
        buildDataParsingPromptWithAnswers: jest.fn().mockReturnValue(mockPromptMessages),
      };
      const mockLLMService = { generateResponse: jest.fn().mockResolvedValue(mockLLMResponse) };
      const testService = new ProfileParserService(mockPromptService as any, mockLLMService as any);

      // Act
      const result = await testService.parseProfileData({ id: 'test-user-1' } as any, 'I am 28 years old, male, 175cm tall, weigh 75kg');

      // Assert
      expect(mockPromptService.buildDataParsingPromptWithAnswers).toHaveBeenCalledWith(
        'I am 28 years old, male, 175cm tall, weigh 75kg',
        expect.any(Object),
        'User profile data parsing',
      );
      expect(result).toEqual({
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight',
      });
    });

    it('should parse partial profile data correctly', async() => {
      // Arrange
      const mockLLMResponse = JSON.stringify({
        age: 25,
        gender: 'female',
        height: null,
        weight: null,
        fitnessLevel: null,
        fitnessGoal: 'build muscle',
      });

      const mockPromptMessages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' },
      ];

      const mockPromptService = {
        buildDataParsingPromptWithAnswers: jest.fn().mockReturnValue(mockPromptMessages),
      };
      const mockLLMService = { generateResponse: jest.fn().mockResolvedValue(mockLLMResponse) };
      const testService = new ProfileParserService(mockPromptService as any, mockLLMService as any);

      // Act
      const result = await testService.parseProfileData({ id: 'test-user' } as any, 'I am 25 years old female, want to build muscle');

      // Assert
      expect(result).toEqual({
        age: 25,
        gender: 'female',
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: 'build muscle',
      });
    });

    it('should handle invalid JSON response', async() => {
      // Arrange
      const mockPromptMessages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' },
      ];

      const mockPromptService = {
        buildDataParsingPromptWithAnswers: jest.fn().mockReturnValue(mockPromptMessages),
      };
      const mockLLMService = { generateResponse: jest.fn().mockResolvedValue('Invalid JSON response') };
      const testService = new ProfileParserService(mockPromptService as any, mockLLMService as any);

      // Act
      const result = await testService.parseProfileData({ id: 'test-user' } as any, 'Some message');

      // Assert
      expect(result).toEqual({
        age: undefined,
        gender: undefined,
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: undefined,
      });
    });

    it('should handle LLM service errors', async() => {
      // Arrange
      const mockPromptMessages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' },
      ];

      const mockPromptService = {
        buildDataParsingPromptWithAnswers: jest.fn().mockReturnValue(mockPromptMessages),
      };
      const mockLLMService = { generateResponse: jest.fn().mockRejectedValue(new Error('LLM service error')) };
      const testService = new ProfileParserService(mockPromptService as any, mockLLMService as any);

      // Act
      const result = await testService.parseProfileData({ id: 'test-user' } as any, 'Some message');

      // Assert
      expect(result).toEqual({
        age: undefined,
        gender: undefined,
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: undefined,
      });
    });
  });

  describe('JSON parsing validation', () => {
    const testCases = [
      {
        name: 'valid complete profile',
        json: '{"age": 30, "gender": "male", "height": 180, "weight": 80, "fitnessLevel": "advanced", "fitnessGoal": "maintain fitness"}',
        expected: {
          age: 30,
          gender: 'male',
          height: 180,
          weight: 80,
          fitnessLevel: 'advanced',
          fitnessGoal: 'maintain fitness',
        },
      },
      {
        name: 'partial profile with nulls',
        json: '{"age": 22, "gender": null, "height": null, "weight": 65, "fitnessLevel": "beginner", "fitnessGoal": null}',
        expected: {
          age: 22,
          gender: undefined,
          height: undefined,
          weight: 65,
          fitnessLevel: 'beginner',
          fitnessGoal: undefined,
        },
      },
      {
        name: 'empty profile',
        json: '{"age": null, "gender": null, "height": null, "weight": null, "fitnessLevel": null, "fitnessGoal": null}',
        expected: {
          age: undefined,
          gender: undefined,
          height: undefined,
          weight: undefined,
          fitnessLevel: undefined,
          fitnessGoal: undefined,
        },
      },
    ];

    testCases.forEach(({ name, json, expected }) => {
      it(`should handle ${name}`, async() => {
        // Arrange
        const mockPromptMessages = [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'User message' },
        ];

        const mockPromptService = {
          buildDataParsingPromptWithAnswers: jest.fn().mockReturnValue(mockPromptMessages),
        };
        const mockLLMService = { generateResponse: jest.fn().mockResolvedValue(json) };
        const testService = new ProfileParserService(mockPromptService as any, mockLLMService as any);

        // Act
        const result = await testService.parseProfileData({ id: 'test-user' } as any, 'test message');

        // Assert
        expect(result).toEqual(expected);
      });
    });
  });
});
