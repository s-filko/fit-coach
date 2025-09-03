import { ParsedProfileData } from './user.service';
import { IPromptService, UniversalParseRequest, UniversalParseResult } from './prompt.service';
import { z } from 'zod';

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
  parseProfileData(text: string): Promise<ParsedProfileData>;
  parseUniversal(request: UniversalParseRequest): Promise<UniversalParseResult>;
}

export class ProfileParserService implements IProfileParserService {
  constructor(
    private readonly promptService: IPromptService,
    private readonly llmService: any // Will be injected
  ) {}

  async parseProfileData(text: string): Promise<ParsedProfileData> {
    try {
      // Build the parsing prompt
      const prompt = this.promptService.buildProfileParsingPrompt(text);

      // Get LLM response
      const llmResponse = await this.llmService.generateResponse(prompt, false);

      // Parse the JSON response
      const parsedResult = JSON.parse(llmResponse);

      // Validate with Zod - ultimate simplicity!
      // Before: 60+ lines of try-catch blocks
      // After: 1 line using generic validation function
      return validateObjectFields<ParsedProfileData>(parsedResult, fieldValidators);
    } catch (error) {
      console.error('Profile parsing error:', error);
      // Return empty object on error
      return {};
    }
  }

  async parseUniversal(request: UniversalParseRequest): Promise<UniversalParseResult> {
    try {
      // Build the universal parsing prompt
      const prompt = this.promptService.buildUniversalParsingPrompt(request);

      // Get LLM response
      const llmResponse = await this.llmService.generateResponse(prompt, false);

      // Parse the JSON response
      const parsedResult = JSON.parse(llmResponse);

      // Simple validation for each field
      const result: UniversalParseResult = {};
      for (const field of request.fields) {
        const value = parsedResult[field.key];
        result[field.key] = this.validateUniversalField(value, field);
      }

      return result;
    } catch (error) {
      console.error('Universal parsing error:', error);
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
