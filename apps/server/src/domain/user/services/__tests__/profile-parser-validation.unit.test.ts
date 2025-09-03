import { ProfileParserService } from '../profile-parser.service';

// Mock LLM service to return controlled responses
const mockLLMService = {
  generateResponse: jest.fn()
};

jest.mock('@infra/ai/llm.service');

describe('ProfileParserService - JSON Validation Unit Tests', () => {
  let parserService: ProfileParserService;

  beforeEach(() => {
    jest.clearAllMocks();
    parserService = new ProfileParserService(
      { buildProfileParsingPrompt: jest.fn() } as any,
      mockLLMService as any
    );
  });

  describe('JSON Response Validation', () => {
    const testCases = [
      {
        name: 'Valid complete JSON response',
        jsonResponse: '{"age": 28, "gender": "male", "height": 175, "weight": 75, "fitnessLevel": "intermediate", "fitnessGoal": "lose weight"}',
        expected: {
          age: 28,
          gender: 'male',
          height: 175,
          weight: 75,
          fitnessLevel: 'intermediate',
          fitnessGoal: 'lose weight'
        }
      },
      {
        name: 'JSON with null values',
        jsonResponse: '{"age": 25, "gender": null, "height": null, "weight": 65, "fitnessLevel": "beginner", "fitnessGoal": null}',
        expected: {
          age: 25,
          gender: undefined,
          height: undefined,
          weight: 65,
          fitnessLevel: 'beginner',
          fitnessGoal: undefined
        }
      },
      {
        name: 'JSON with invalid data types',
        jsonResponse: '{"age": "twenty five", "gender": "male", "height": 170, "weight": 70, "fitnessLevel": "intermediate", "fitnessGoal": "run"}',
        expected: {
          age: undefined, // String should become undefined
          gender: 'male',
          height: 170,
          weight: 70,
          fitnessLevel: 'intermediate',
          fitnessGoal: 'run'
        }
      },
      {
        name: 'JSON with out of range values',
        jsonResponse: '{"age": 150, "gender": "male", "height": 50, "weight": 300, "fitnessLevel": "expert", "fitnessGoal": "fly"}',
        expected: {
          age: undefined, // Age > 100 should be undefined
          gender: 'male',
          height: undefined, // Height < 120 should be undefined
          weight: undefined, // Weight > 200 should be undefined
          fitnessLevel: undefined, // Invalid fitness level
          fitnessGoal: 'fly' // Valid string
        }
      },
      {
        name: 'Empty JSON response',
        jsonResponse: '{"age": null, "gender": null, "height": null, "weight": null, "fitnessLevel": null, "fitnessGoal": null}',
        expected: {
          age: undefined,
          gender: undefined,
          height: undefined,
          weight: undefined,
          fitnessLevel: undefined,
          fitnessGoal: undefined
        }
      },
      {
        name: 'Partial valid data',
        jsonResponse: '{"age": 30, "gender": "female", "height": 165, "weight": null, "fitnessLevel": null, "fitnessGoal": "maintain health"}',
        expected: {
          age: 30,
          gender: 'female',
          height: 165,
          weight: undefined,
          fitnessLevel: undefined,
          fitnessGoal: 'maintain health'
        }
      }
    ];

    testCases.forEach(({ name, jsonResponse, expected }) => {
      it(`should validate ${name}`, async () => {
        mockLLMService.generateResponse.mockResolvedValue(jsonResponse);

        const result = await parserService.parseProfileData('test message');

        expect(result).toEqual(expected);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON', async () => {
      mockLLMService.generateResponse.mockResolvedValue('{invalid json');

      const result = await parserService.parseProfileData('test message');

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
      mockLLMService.generateResponse.mockRejectedValue(new Error('LLM service failed'));

      const result = await parserService.parseProfileData('test message');

      expect(result).toEqual({
        age: undefined,
        gender: undefined,
        height: undefined,
        weight: undefined,
        fitnessLevel: undefined,
        fitnessGoal: undefined
      });
    });

    it('should handle empty response', async () => {
      mockLLMService.generateResponse.mockResolvedValue('');

      const result = await parserService.parseProfileData('test message');

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

  describe('Data Type Validation', () => {
    const validationTestCases = [
      {
        name: 'Valid integer age',
        json: '{"age": 25, "gender": null, "height": null, "weight": null, "fitnessLevel": null, "fitnessGoal": null}',
        expectedAge: 25
      },
      {
        name: 'Valid string gender',
        json: '{"age": null, "gender": "female", "height": null, "weight": null, "fitnessLevel": null, "fitnessGoal": null}',
        expectedGender: 'female'
      },
      {
        name: 'Valid fitness level enum',
        json: '{"age": null, "gender": null, "height": null, "weight": null, "fitnessLevel": "advanced", "fitnessGoal": null}',
        expectedFitnessLevel: 'advanced'
      },
      {
        name: 'Valid string fitness goal',
        json: '{"age": null, "gender": null, "height": null, "weight": null, "fitnessLevel": null, "fitnessGoal": "build muscle"}',
        expectedFitnessGoal: 'build muscle'
      }
    ];

    validationTestCases.forEach(({ name, json, expectedAge, expectedGender, expectedFitnessLevel, expectedFitnessGoal }) => {
      it(`should validate ${name}`, async () => {
        mockLLMService.generateResponse.mockResolvedValue(json);

        const result = await parserService.parseProfileData('test message');

        if (expectedAge !== undefined) expect(result.age).toBe(expectedAge);
        if (expectedGender !== undefined) expect(result.gender).toBe(expectedGender);
        if (expectedFitnessLevel !== undefined) expect(result.fitnessLevel).toBe(expectedFitnessLevel);
        if (expectedFitnessGoal !== undefined) expect(result.fitnessGoal).toBe(expectedFitnessGoal);
      });
    });
  });
});
