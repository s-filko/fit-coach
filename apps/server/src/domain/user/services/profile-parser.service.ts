import { ParsedProfileData, User } from './user.service';
import {
  DataFieldsConfig,
  PromptService,
  UniversalParseRequest,
  UniversalParseResult,
  FieldDefinition,
} from './prompt.service';
import { z } from 'zod';
import { LLMService } from '@infra/ai/llm.service';

// Helper function for Zod validation with fallback to undefined
function validateWithFallback<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

// Generic function to validate object fields using configuration
function validateObjectFields<T extends Record<string, unknown>>(
  data: Record<string, unknown>,
  validators: Record<keyof T, z.ZodType<unknown>>,
): T {
  const result = {} as T;
  for (const [key, validator] of Object.entries(validators)) {
    (result as Record<string, unknown>)[key] = validateWithFallback(validator, data[key]);
  }
  return result;
}

// Declarative field validation configuration
const fieldValidators = {
  age: z.union([z.number().int().min(10).max(100), z.null()]).transform(val => val ?? undefined),
  gender: z.union([z.enum(['male', 'female']), z.null()]).transform(val => val ?? undefined),
  height: z.union([z.number().int().min(120).max(220), z.null()]).transform(val => val ?? undefined),
  weight: z.union([z.number().int().min(30).max(200), z.null()]).transform(val => val ?? undefined),
  fitnessLevel: z.union([z.enum(['beginner', 'intermediate', 'advanced']), z.null()]).transform(val => val ?? undefined),
  fitnessGoal: z.union([z.string().min(1).max(100), z.null()]).transform(val => val ?? undefined),
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
    private readonly llmService: LLMService,
  ) {}

  async parseProfileData(user: User, text: string): Promise<ParsedProfileData> {
    // Input validation
    if (!user?.id) {
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
      fitnessGoal: 'User\'s fitness goal (lose weight, build muscle, maintain fitness, etc.)',
    };

    // Filter out already collected data
    const promptDataConfig: DataFieldsConfig = Object.fromEntries(
      Object.entries(basePromptDataConfig).filter(([key]) => {
        const userValue = (user as unknown as Record<string, unknown>)[key];
        // Check if field is empty (undefined, null, or empty string)
        return userValue === undefined || userValue === null || userValue === '';
      }),
    );

    try {
      // Build the parsing prompt
      const prompt = this.promptService.buildDataParsingPromptWithAnswers(
        text,
        promptDataConfig,
        'User profile data parsing',
      );

      // Get LLM response
      const llmResponse = await this.llmService.generateResponse(prompt, false);

      // Parse the JSON response
      const parsedResult = JSON.parse(llmResponse) as unknown;

      // Extract data from the nested format returned by LLM
      let extractedData: Record<string, unknown> = {};
      const parsedResultObj = parsedResult as Record<string, unknown>;
      if (parsedResultObj.hasData && (parsedResultObj.data as Record<string, unknown>)?.fields) {
        extractedData = (parsedResultObj.data as Record<string, unknown>).fields as Record<string, unknown>;
      } else {
        // Fallback to direct format if LLM returns data directly
        extractedData = parsedResultObj;
      }

      // Validate with Zod - ultimate simplicity!
      // Before: 60+ lines of try-catch blocks
      // After: 1 line using generic validation function
      const validatedResult = validateObjectFields<ParsedProfileData>(extractedData, fieldValidators);

      // validatedResult is already filtered/validated above; no extra debug bookkeeping
      return validatedResult;
    } catch {
      // Return empty object on error
      return {};
    }
  }

  async parseUniversal(request: UniversalParseRequest): Promise<UniversalParseResult> {
    // Input validation
    if (!request?.text || !request.fields || !Array.isArray(request.fields)) {
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
      const parsedResult = JSON.parse(llmResponse) as Record<string, unknown>;

      // Validate each field according to its type and constraints
      const result: UniversalParseResult = {};
      for (const field of request.fields) {
        const value = parsedResult[field.key];
        result[field.key] = this.validateUniversalField(value, field);
      }

      return result;
    } catch {

      // Return object with null values for all fields
      const result: UniversalParseResult = {};
      for (const field of request.fields) {
        result[field.key] = null;
      }
      return result;
    }
  }

  private validateUniversalField(value: unknown, field: FieldDefinition): unknown {
    if (value === null || value === undefined) {return null;}

    switch (field.type) {
      case 'number':
        if (typeof value === 'number') {
          // Apply validation rules if specified
          if (field.validation) {
            if (field.validation.min !== undefined && value < field.validation.min) {return null;}
            if (field.validation.max !== undefined && value > field.validation.max) {return null;}
          }
          return Math.round(value);
        }
        return null;

      case 'boolean':
        return typeof value === 'boolean' ? value : null;

      case 'enum':
        if (field.enumValues?.includes(value as string)) {
          return value;
        }
        return null;

      case 'string':
      default:
        if (typeof value === 'string' && value.trim().length > 0) {
          // Apply pattern validation if specified
          if (field.validation?.pattern) {
            const regex = new RegExp(field.validation.pattern);
            if (!regex.test(value)) {return null;}
          }
          return value.trim();
        }
        return null;
    }
  }
}
