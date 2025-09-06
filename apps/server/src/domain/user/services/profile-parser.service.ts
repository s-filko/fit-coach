import { ParsedProfileData, User } from './user.service';
import {
  DataFieldsConfig,
  IPromptService,
  PromptService,
  UniversalParseRequest,
  UniversalParseResult
} from './prompt.service';
import { z } from 'zod';
import { ILLMService, LLMService } from "@infra/ai/llm.service";

// Helper function for Zod validation with fallback to undefined
function validateWithFallback<T>(schema: z.ZodType<T>, value: any): T | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

// Generic function to validate object fields using configuration
function validateObjectFields<T extends Record<string, any>>(
  data: any,
  validators: Record<keyof T, z.ZodType<any>>
): T {
  const result = {} as T;
  for (const [key, validator] of Object.entries(validators)) {
    (result as any)[key] = validateWithFallback(validator, data[key]);
  }
  return result;
}

// Declarative field validation configuration
const fieldValidators = {
  age: z.union([z.number().int().min(10).max(100), z.null()]).transform(val => val === null ? undefined : val),
  gender: z.union([z.enum(['male', 'female']), z.null()]).transform(val => val === null ? undefined : val),
  height: z.union([z.number().int().min(120).max(220), z.null()]).transform(val => val === null ? undefined : val),
  weight: z.union([z.number().int().min(30).max(200), z.null()]).transform(val => val === null ? undefined : val),
  fitnessLevel: z.union([z.enum(['beginner', 'intermediate', 'advanced']), z.null()]).transform(val => val === null ? undefined : val),
  fitnessGoal: z.union([z.string().min(1).max(100), z.null()]).transform(val => val === null ? undefined : val),
  limitations: z.array(z.string()).optional(),
  equipment: z.array(z.string()).optional(),
} as const;



export interface IProfileParserService {
  parseProfileData(user: User, text: string): Promise<ParsedProfileData>;
  parseUniversal(request: UniversalParseRequest): Promise<UniversalParseResult>;
}

export class ProfileParserService implements IProfileParserService {
  constructor(
    private readonly promptService: PromptService,
    private readonly llmService: LLMService
  ) {}

  async parseProfileData(user: User, text: string): Promise<ParsedProfileData> {
    // Input validation
    if (!user || !user.id) {
      throw new Error('Invalid user: user and user.id are required');
    }
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Invalid text: text must be a non-empty string');
    }

    const basePromptDataConfig: DataFieldsConfig = {
      age: 'User\'s age in years (10-100)',
      gender: 'User\'s gender (male or female)',
      height: 'User\'s height in centimeters (convert from feet/inches if needed)',
      weight: 'User\'s weight in kilograms (convert from pounds if needed)',
      fitnessLevel: 'User\'s fitness experience (beginner, intermediate, advanced)',
      fitnessGoal: 'User\'s fitness goal (lose weight, build muscle, maintain fitness, etc.)'
    }

    // Filter out already collected data
    const promptDataConfig: DataFieldsConfig = Object.fromEntries(
      Object.entries(basePromptDataConfig).filter(([key]) => {
        const userValue = (user as any)[key];
        // Check if field is empty (undefined, null, or empty string)
        return userValue === undefined || userValue === null || userValue === '';
      })
    );

    try {
      // Build the parsing prompt
      const prompt = this.promptService.buildDataParsingPromptWithAnswers(
        text,
        promptDataConfig,
        'User profile data parsing'
      );

      // Get LLM response
      const llmResponse = await this.llmService.generateResponse(prompt, false);

      // Parse the JSON response
      const parsedResult = JSON.parse(llmResponse);

      // Extract data from the nested format returned by LLM
      let extractedData: any = {};
      if (parsedResult.hasData && parsedResult.data && parsedResult.data.fields) {
        extractedData = parsedResult.data.fields;
      } else {
        // Fallback to direct format if LLM returns data directly
        extractedData = parsedResult;
      }

      // Validate with Zod - ultimate simplicity!
      // Before: 60+ lines of try-catch blocks
      // After: 1 line using generic validation function
      const validatedResult = validateObjectFields<ParsedProfileData>(extractedData, fieldValidators);

      // Log successful parsing
      const extractedFields = Object.entries(validatedResult)
        .filter(([_, value]) => value !== undefined)
        .map(([key]) => key);

      console.log('Profile data parsed successfully:', {
        userId: user.id,
        extractedFields,
        totalFields: Object.keys(validatedResult).length
      });

      return validatedResult;
    } catch (error) {
      console.error('Profile parsing error:', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        inputText: text,
        filteredFields: Object.keys(promptDataConfig)
      });
      // Return empty object on error
      return {};
    }
  }

  async parseUniversal(request: UniversalParseRequest): Promise<UniversalParseResult> {
    // Input validation
    if (!request || !request.text || !request.fields || !Array.isArray(request.fields)) {
      throw new Error('Invalid request: text and fields array are required');
    }
    if (request.fields.length === 0) {
      throw new Error('Invalid request: at least one field must be specified');
    }

    try {
      // Build the universal parsing prompt as ChatMsg array
      const promptText = this.promptService.buildUniversalParsingPrompt(request);
      const prompt = [{ role: 'user' as const, content: promptText }];

      // Get LLM response
      const llmResponse = await this.llmService.generateResponse(prompt, false);

      // Parse the JSON response
      const parsedResult = JSON.parse(llmResponse);

      // Validate each field according to its type and constraints
      const result: UniversalParseResult = {};
      for (const field of request.fields) {
        const value = parsedResult[field.key];
        result[field.key] = this.validateUniversalField(value, field);
      }

      return result;
    } catch (error) {
      console.error('Universal parsing error:', {
        error: error instanceof Error ? error.message : String(error),
        fieldCount: request.fields.length,
        text: request.text.substring(0, 100) + '...'
      });

      // Return object with null values for all fields
      const result: UniversalParseResult = {};
      for (const field of request.fields) {
        result[field.key] = null;
      }
      return result;
    }
  }

  private validateUniversalField(value: any, field: any): any {
    if (value === null || value === undefined) return null;

    switch (field.type) {
      case 'number':
        if (typeof value === 'number') {
          // Apply validation rules if specified
          if (field.validation) {
            if (field.validation.min !== undefined && value < field.validation.min) return null;
            if (field.validation.max !== undefined && value > field.validation.max) return null;
          }
          return Math.round(value);
        }
        return null;

      case 'boolean':
        return typeof value === 'boolean' ? value : null;

      case 'enum':
        if (field.enumValues && field.enumValues.includes(value)) {
          return value;
        }
        return null;

      case 'string':
      default:
        if (typeof value === 'string' && value.trim().length > 0) {
          // Apply pattern validation if specified
          if (field.validation?.pattern) {
            const regex = new RegExp(field.validation.pattern);
            if (!regex.test(value)) return null;
          }
          return value.trim();
        }
        return null;
    }
  }
}
