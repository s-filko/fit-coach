import { USER_MESSAGES } from './messages';

// Universal parsing interfaces
export interface FieldDefinition {
  key: string;
  description: string;
  type: 'number' | 'string' | 'boolean' | 'enum';
  enumValues?: string[];
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface UniversalParseRequest {
  text: string;
  fields: FieldDefinition[];
}

export interface UniversalParseResult {
  [key: string]: any | null;
}

export interface IPromptService {
  buildRegistrationSystemPrompt(context?: string): string;
  buildChatSystemPrompt(): string;
  buildProfileParsingPrompt(text: string): string;
  buildUniversalParsingPrompt(request: UniversalParseRequest): string;
  buildWelcomeMessage(): string;
  buildBasicInfoSuccessMessage(age: number, gender: string, height: number, weight: number): string;
  buildClarificationMessage(missingFields: string[]): string;
  buildFitnessLevelQuestion(): string;
  buildFitnessLevelSuccessMessage(level: string): string;
  buildGoalQuestion(): string;
  buildGoalsSuccessMessage(goal: string, profileData: any): string;
  buildConfirmationPrompt(profileData: any): string;
  buildRegistrationCompleteMessage(): string;
  buildProfileResetMessage(): string;
  buildConfirmationNeededMessage(): string;
  buildClarificationPrompt(missingFields: string[]): string;
  buildProgressChecklist(completedFields: string[]): string;
}

export class PromptService implements IPromptService {
  /**
   * System prompt for registration mode
   */
  buildRegistrationSystemPrompt(context?: string): string {
    const basePrompt = `You are a friendly AI fitness coach helping users complete their profile registration.

Your task is to:
1. Be patient and encouraging during profile collection
2. Ask clear, simple questions one at a time
3. Confirm information you've collected
4. Guide users through the registration process step by step
5. Keep responses brief and friendly

Current context: ${context || 'Starting profile registration'}

Always respond in English.`;

    return basePrompt;
  }

  /**
   * System prompt for general chat mode
   */
  buildChatSystemPrompt(): string {
    return `You are a friendly AI fitness coach. Respond to user messages briefly, motivatively, and friendly. Do not collect profile data, just maintain conversation as a good coach.`;
  }

  /**
   * Prompt for parsing profile data from user text
   */
  buildProfileParsingPrompt(text: string): string {
    return `You are an AI assistant that extracts structured profile information from user messages.

TASK: Extract the following information from the user's message. Be extremely precise and only extract information that is clearly stated.

REQUIRED OUTPUT FORMAT: Return ONLY a valid JSON object with this exact structure:
{
  "age": integer (10-100) or null if not mentioned,
  "gender": "male" or "female" or null if not mentioned,
  "height": integer in cm (120-220) or null if not mentioned,
  "weight": integer in kg (30-200) or null if not mentioned,
  "fitnessLevel": "beginner" or "intermediate" or "advanced" or null if not mentioned,
  "fitnessGoal": string describing goal (e.g., "lose weight", "build muscle") or null if not mentioned
}

EXTRACTION RULES:
1. Only extract information that is EXPLICITLY mentioned in the message
2. Convert all measurements to metric: cm for height, kg for weight
3. Use exact values provided - do not estimate or round unnecessarily
4. If a field is not mentioned at all, use null (not empty string)
5. Be conservative - if unsure, use null
6. Look for variations: "guy/man/male", "girl/woman/female", "lbs/pounds"→convert to kg, "ft/feet"→convert to cm

EXAMPLE INPUT: "I'm a 28 year old male, 5'10" tall and weigh 165 pounds. I want to lose weight."
EXAMPLE OUTPUT: {"age": 28, "gender": "male", "height": 178, "weight": 75, "fitnessLevel": null, "fitnessGoal": "lose weight"}

USER MESSAGE: "${text}"`;
  }

  /**
   * Universal prompt for parsing any fields from text
   */
  buildUniversalParsingPrompt(request: UniversalParseRequest): string {
    const { text, fields } = request;

    // Build field descriptions for the prompt
    const fieldDescriptions = fields.map(field => {
      let description = `"${field.key}": ${field.description}`;

      if (field.type === 'enum' && field.enumValues) {
        description += ` (possible values: ${field.enumValues.join(', ')})`;
      } else if (field.type === 'number' && field.validation) {
        if (field.validation.min !== undefined && field.validation.max !== undefined) {
          description += ` (range: ${field.validation.min}-${field.validation.max})`;
        }
      }

      return description;
    }).join('\n  ');

    // Build expected output structure
    const expectedKeys = fields.map(field => `  "${field.key}": ${this.getExpectedTypeString(field)} or null`).join(',\n');

    return `Extract specific information from the user's message.
Be very careful and accurate. If information is unclear or ambiguous, use null.

Fields to extract:
  ${fieldDescriptions}

Rules:
- Extract only explicitly mentioned information
- If you're not confident about a value, use null
- Respect field types and validation rules
- For enum fields, use only the specified values or null
- For number fields, ensure values are reasonable

Return ONLY a JSON object with this exact structure:
{
${expectedKeys}
}

User message: "${text}"`;
  }

  private getExpectedTypeString(field: FieldDefinition): string {
    switch (field.type) {
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'enum':
        return `"${field.enumValues?.join('"|"') || 'string'}"`;
      case 'string':
      default:
        return 'string';
    }
  }

  /**
   * Question for fitness level determination
   */
  buildFitnessLevelQuestion(): string {
    return `Now let's determine your fitness level. Which option best describes you:

• Beginner - I have little or no regular exercise experience
• Intermediate - I've been exercising regularly for 1-2 years
• Advanced - I've been exercising regularly for more than 2 years

Please reply with just one word: beginner, intermediate, or advanced.`;
  }

  /**
   * Question for fitness goals
   */
  buildGoalQuestion(): string {
    return `What is your main fitness goal?

• Weight loss - lose weight and burn fat
• Muscle gain - build muscle mass
• Maintain - keep current fitness level
• General fitness - improve overall health
• Strength - increase strength and power

Please reply with one of these options or describe your own goal.`;
  }

  /**
   * Confirmation prompt with collected data
   */
  buildConfirmationPrompt(profileData: any): string {
    const dataSummary = [
      profileData.age ? `Age: ${profileData.age} years` : 'Age: not specified',
      profileData.gender ? `Gender: ${profileData.gender === 'male' ? 'male' : 'female'}` : 'Gender: not specified',
      profileData.height ? `Height: ${profileData.height} cm` : 'Height: not specified',
      profileData.weight ? `Weight: ${profileData.weight} kg` : 'Weight: not specified',
      profileData.fitnessLevel ? `Level: ${profileData.fitnessLevel}` : 'Level: not specified',
      profileData.fitnessGoal ? `Goal: ${profileData.fitnessGoal}` : 'Goal: not specified'
    ].join('\n');

    return `Let's review the information I've collected:

${dataSummary}

Is this information correct? Reply with:
• "yes" - to confirm and complete registration
• "no" - to make corrections
• "edit [field]" - to change a specific field (for example: "edit age")`;
  }

  /**
   * Prompt for clarification when information is missing or unclear
   */
  buildClarificationPrompt(missingFields: string[]): string {
    const fieldNames: Record<string, string> = {
      'age': 'age',
      'gender': 'gender',
      'height': 'height',
      'weight': 'weight',
      'fitnessLevel': 'fitness level',
      'fitnessGoal': 'fitness goal'
    };

    const readableFields = missingFields.map(field => fieldNames[field] || field).join(', ');

    return `I need more information about: ${readableFields}.

Please provide this information more clearly. For example:
• Age: "I am 28 years old" or "28"
• Height: "175 cm" or "5 feet 9 inches"
• Weight: "75 kg" or "165 pounds"`;
  }

  /**
   * Welcome message for new users (Russian)
   * Uses predefined user messages from messages.ts
   */
  buildWelcomeMessage(): string {
    return USER_MESSAGES.WELCOME;
  }

  /**
   * Success message after collecting basic info
   * Uses predefined user message with dynamic content
   */
  buildBasicInfoSuccessMessage(age: number, gender: string, height: number, weight: number): string {
    return USER_MESSAGES.BASIC_INFO_SUCCESS(age, gender, height, weight);
  }

  /**
   * Fitness level success message
   * Uses predefined user message with dynamic content
   */
  buildFitnessLevelSuccessMessage(level: string): string {
    return USER_MESSAGES.FITNESS_LEVEL_SUCCESS(level);
  }

  /**
   * Goals success message
   * Uses predefined user message with dynamic content
   */
  buildGoalsSuccessMessage(goal: string, profileData: any): string {
    return USER_MESSAGES.GOALS_SUCCESS(goal, profileData);
  }

  /**
   * Registration complete message
   * Uses predefined user message
   */
  buildRegistrationCompleteMessage(): string {
    return USER_MESSAGES.REGISTRATION_COMPLETE;
  }

  /**
   * Clarification request message
   * Uses predefined user message with dynamic content
   */
  buildClarificationMessage(missingFields: string[]): string {
    return USER_MESSAGES.CLARIFICATION(missingFields);
  }

  /**
   * Confirmation needed message
   * Uses predefined user message
   */
  buildConfirmationNeededMessage(): string {
    return USER_MESSAGES.CONFIRMATION_NEEDED;
  }

  /**
   * Profile reset message
   * Uses predefined user message
   */
  buildProfileResetMessage(): string {
    return USER_MESSAGES.PROFILE_RESET;
  }



  /**
   * Progress checklist display
   */
  buildProgressChecklist(completedFields: string[]): string {
    const allFields = ['age', 'gender', 'height', 'weight', 'fitnessLevel', 'fitnessGoal'];
    const fieldNames: Record<string, string> = {
      'age': 'Basic info',
      'gender': 'Basic info',
      'height': 'Basic info',
      'weight': 'Basic info',
      'fitnessLevel': 'Fitness level',
      'fitnessGoal': 'Goals'
    };

    const checklist = allFields.map(field => {
      const isCompleted = completedFields.includes(field);
      const status = isCompleted ? '✅' : '❌';
      return `${status} ${fieldNames[field]}`;
    }).join('\n');

    return `📋 Registration Progress:\n${checklist}`;
  }
}
