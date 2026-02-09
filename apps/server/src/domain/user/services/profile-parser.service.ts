import { LLMService } from '@domain/ai/ports';
import { FieldDefinition, IProfileParserService, IPromptService, UniversalParseRequest, UniversalParseResult } from '@domain/user/ports';
import { validateProfileFields } from '@domain/user/services/registration.validation';
import { ParsedProfileData, User } from '@domain/user/services/user.service';

// Strip markdown code block wrapper if present (e.g. ```json ... ```)
function stripJsonFromMarkdown(raw: string): string {
  const trimmed = raw.trim();
  const codeBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  return codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;
}

export class ProfileParserService implements IProfileParserService {
  constructor(
    private readonly promptService: IPromptService,
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

    // Filter out already collected data
    const alreadyCollected: Partial<ParsedProfileData> = Object.fromEntries(
      Object.entries(user).filter(([, value]) => {
        // Check if field has meaningful data (not empty, null, or undefined)
        return value !== undefined && value !== null && value !== '';
      }),
    );

    try {
      // Build the parsing prompt
      const prompt = this.promptService.buildProfileParsingPrompt(text, alreadyCollected);

      // Get LLM response
      const rawResponse = await this.llmService.generateResponse(prompt, false);
      const llmResponse = stripJsonFromMarkdown(rawResponse);

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

      const validatedResult = validateProfileFields(extractedData);
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
