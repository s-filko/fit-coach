import { ProfileParserService } from '../profile-parser.service';
import { LLMService } from '@infra/ai/llm.service';

// Mock LLM service
jest.mock('@infra/ai/llm.service');

describe('ProfileParserService', () => {
  let parserService: ProfileParserService;
  let mockLLMService: jest.Mocked<LLMService>;

  beforeEach(() => {
    mockLLMService = new LLMService() as jest.Mocked<LLMService>;
    parserService = new ProfileParserService(
      { buildProfileParsingPrompt: jest.fn() } as any,
      mockLLMService
    );
  });

  describe('parseProfileData with mock responses', () => {
    it('should parse complete profile data correctly', async () => {
      // Mock LLM response with valid JSON
      const mockLLMResponse = JSON.stringify({
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight'
      });

      mockLLMService.generateResponse.mockResolvedValue(mockLLMResponse);

      const result = await parserService.parseProfileData('I am 28 years old, male, 175cm tall, weigh 75kg');

      expect(result).toEqual({
        age: 28,
        gender: 'male',
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight'
      });
    });

    it('should parse partial profile data correctly', async () => {
      const mockLLMResponse = JSON.stringify({
        age: 25,
        gender: 'female',
        height: null,
        weight: null,
        fitnessLevel: null,
        fitnessGoal: 'build muscle'
      });

      mockLLMService.generateResponse.mockResolvedValue(mockLLMResponse);

      const result = await parserService.parseProfileData('I am 25 years old female, want to build muscle');

      expect(result).toEqual({
        age: 25,
        gender: 'female',
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: 'build muscle'
      });
    });

    it('should handle invalid JSON response', async () => {
      mockLLMService.generateResponse.mockResolvedValue('Invalid JSON response');

      const result = await parserService.parseProfileData('Some message');

      expect(result).toEqual({
        age: undefined,
        gender: undefined,
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: undefined
      });
    });

    it('should handle LLM service errors', async () => {
      mockLLMService.generateResponse.mockRejectedValue(new Error('LLM service error'));

      const result = await parserService.parseProfileData('Some message');

      expect(result).toEqual({
        age: undefined,
        gender: undefined,
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: undefined
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
          fitnessGoal: 'maintain fitness'
        }
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
          fitnessGoal: undefined
        }
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
          fitnessGoal: undefined
        }
      }
    ];

    testCases.forEach(({ name, json, expected }) => {
      it(`should handle ${name}`, async () => {
        mockLLMService.generateResponse.mockResolvedValue(json);

        const result = await parserService.parseProfileData('test message');

        expect(result).toEqual(expected);
      });
    });
  });
});
