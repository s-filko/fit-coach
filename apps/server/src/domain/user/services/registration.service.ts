import { LLMService } from '@domain/ai/ports';
import { ChatMsg, IPromptService, IRegistrationService } from '@domain/user/ports';

import type { Logger } from '@shared/logger';

import { type ProfileDataKey, registrationLLMResponseSchema, validateExtractedFields } from './registration.validation';
import { ParsedProfileData, User } from './user.service';

const REQUIRED_FIELDS: ProfileDataKey[] = ['age', 'gender', 'height', 'weight', 'fitnessLevel', 'fitnessGoal'];

const FALLBACK_RESPONSE = 'I\'m having a bit of trouble processing that. Could you please try again?';

/** Strip markdown code block wrapper if present (e.g. ```json ... ```) */
function stripJsonFromMarkdown(raw: string): string {
  const trimmed = raw.trim();
  // Match ```json ... ``` anywhere in the string (Gemini sometimes adds text around it)
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    return match[1].trim();
  }
  // Try to extract first JSON object from the string
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  return trimmed;
}

export class RegistrationService implements IRegistrationService {
  constructor(
    private readonly promptService: IPromptService,
    private readonly llmService: LLMService,
  ) {}

  async processUserMessage(
    user: User,
    message: string,
    historyMessages: ChatMsg[] = [],
    opts?: { log?: Logger },
  ): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
    phaseTransition?: { toPhase: 'chat' | 'plan_creation'; reason?: string };
  }> {
    const log = opts?.log;

    // 1. Build system prompt with current profile state
    const systemPrompt = this.promptService.buildUnifiedRegistrationPrompt(user);

    // 2. Assemble messages: history + current user message
    const messages: ChatMsg[] = [
      ...historyMessages,
      { role: 'user', content: message },
    ];

    // 3. Call LLM — single call for both parsing and response
    let rawResponse: string;
    try {
      rawResponse = await this.llmService.generateWithSystemPrompt(
        messages, systemPrompt, { jsonMode: true, log },
      );
    } catch {
      return { updatedUser: user, response: FALLBACK_RESPONSE, isComplete: false };
    }

    // 4. Parse and validate JSON response
    let parsed: typeof registrationLLMResponseSchema._output;
    try {
      const cleaned = stripJsonFromMarkdown(rawResponse);
      const json = JSON.parse(cleaned) as Record<string, unknown>;
      parsed = registrationLLMResponseSchema.parse(json);
    } catch {
      return { updatedUser: user, response: FALLBACK_RESPONSE, isComplete: false };
    }

    // 5. Validate extracted fields with strict Zod validators
    const validatedFields = validateExtractedFields(
      parsed.extracted_data as Record<string, unknown>,
    );

    // 6. Merge valid non-null fields into user (don't overwrite existing with null)
    const updatedUser = { ...user };
    for (const key of REQUIRED_FIELDS) {
      const newValue = validatedFields[key];
      if (newValue !== undefined && newValue !== null) {
        (updatedUser as Record<string, unknown>)[key] = newValue;
      }
    }
    // Save name if LLM extracted it
    const extractedName = (parsed.extracted_data as Record<string, unknown>).name;
    if (typeof extractedName === 'string' && extractedName.trim()) {
      updatedUser.firstName = extractedName.trim();
    }

    // 7. Check completeness: all 6 fields present AND user confirmed
    const allFieldsPresent = REQUIRED_FIELDS.every((k) => {
      const v = updatedUser[k as keyof User];
      return v !== undefined && v !== null && v !== '';
    });

    const isComplete = allFieldsPresent && parsed.is_confirmed;
    if (isComplete) {
      updatedUser.profileStatus = 'complete';
    } else if (updatedUser.profileStatus !== 'registration') {
      // Normalize any legacy status to 'registration'
      updatedUser.profileStatus = 'registration';
    }

    return {
      updatedUser,
      response: parsed.response,
      isComplete,
      parsedData: validatedFields,
      phaseTransition: parsed.phaseTransition,
    };
  }

  checkProfileCompleteness(user: User): boolean {
    return !!(
      user.age && user.gender && user.height && user.weight &&
      user.fitnessLevel && user.fitnessGoal && user.profileStatus === 'complete'
    );
  }
}
