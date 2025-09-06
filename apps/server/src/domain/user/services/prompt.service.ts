import { ChatMsg, DataFieldsConfig, EnhancedDataParsingConfig, FieldDefinition, IPromptService, UniversalParseRequest } from '@domain/user/ports';
import { USER_MESSAGES } from '@domain/user/services/messages';
import { ParsedProfileData } from '@domain/user/services/user.service';

// Data parsing response interface
export interface DataParsingResponse {
  hasData: boolean;
  data: {
    date?: string;
    intent?: string;
    fields?: { [key: string]: unknown };
  } | null;
  reply: string;
}

export class PromptService implements IPromptService {
  /**
   * System prompt for registration mode
   */
  buildRegistrationSystemPrompt(context?: string): string {
    const basePrompt = 'You are a friendly AI fitness coach helping users complete their profile registration. ' +
      'Your task is to: ' +
      '1. Be patient and encouraging during profile collection ' +
      '2. Ask clear, simple questions one at a time ' +
      '3. Confirm information you\'ve collected ' +
      '4. Guide users through the registration process step by step ' +
      '5. Keep responses brief and friendly ' +
      `Current context: ${context ?? 'Starting profile registration'} ` +
      'Always respond in English.';

    return basePrompt;
  }

  /**
   * System prompt for general chat mode
   */
  buildChatSystemPrompt(): string {
    return 'You are a friendly AI fitness coach. Respond to user messages briefly, motivatively, and friendly. Do not collect profile data, just maintain conversation as a good coach.';
  }

  /**
   * Profile parsing with smart responses and filtering of already collected data
   * @param text - User's input message
   * @param alreadyCollected - Previously collected profile data (filtered out from AI request)
   */
  buildProfileParsingPrompt(
    text: string, 
    alreadyCollected: Partial<ParsedProfileData> = {},
  ): ChatMsg[] {
    // Define profile fields configuration
    const profileFieldsConfig: DataFieldsConfig = {
      age: 'User\'s age in years (10-100)',
      gender: 'User\'s gender (male or female)',
      height: 'User\'s height in centimeters (convert from feet/inches if needed)',
      weight: 'User\'s weight in kilograms (convert from pounds if needed)',
      fitnessLevel: 'User\'s fitness experience (beginner, intermediate, advanced)',
      fitnessGoal: 'User\'s fitness goal (lose weight, build muscle, maintain fitness, etc.)',
    };

    // Determine required fields (all profile fields are required for complete profile)
    const requiredFields = Object.keys(profileFieldsConfig);
    
    const config: EnhancedDataParsingConfig = {
      fieldsConfig: profileFieldsConfig,
      alreadyCollected,
      requiredFields,
      optionalFields: [],
    };
    
    return this.buildEnhancedDataParsingPrompt(
      text,
      config,
      'User profile registration - collecting fitness profile information',
    );
  }

  /**
   * Build a prompt for parsing specific data fields from user message with structured response
   * @param userMsg - User's input message to analyze
   * @param fieldsConfig - Object where keys are field names and values are descriptions for LLM
   * @param domainHint - Optional domain context for better understanding
   */
  buildDataParsingPromptWithAnswers(
    userMsg: string,
    fieldsConfig: DataFieldsConfig,
    domainHint?: string,
  ): ChatMsg[] {
    // If no fields are missing, return simple response
    if (Object.keys(fieldsConfig).length === 0) {
      const systemPrompt = 'You are a data extraction engine. All requested data is already collected.';
      const userPrompt = `User message: ${userMsg} ` +
        'All requested information is already available. Respond with: ' +
        '{ ' +
        '  "hasData": false, ' +
        '  "data": null, ' +
        '  "reply": "Thank you! I already have all the information I need." ' +
        '}';

      return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
    }

    // Generate field descriptions for missing fields only
    const fieldDescriptions = Object.entries(fieldsConfig)
      .map(([key, description]) => `  "${key}": ${description}`)
      .join('\n');

    // Generate expected fields structure for schema with descriptions as comments
    const expectedFields = Object.entries(fieldsConfig)
      .map(([key, description]) => `    "${key}": any // ${description}`)
      .join(',\n');

    const schemaText = '{ ' +
      '  "hasData": boolean, ' +
      '  "data": { ' +
      '    "date"?: string, ' +
      '    "intent"?: string, ' +
      '    "fields"?: { ' +
      `${expectedFields} ` +
      '    } ' +
      '  } | null, ' +
      '  "reply": string ' +
      '}';

    const rules = [
      'Return ONLY valid JSON matching the schema. No prose or explanation.',
      'CRITICAL: Extract data only when you can CLEARLY identify what each value represents.',
      'ACCEPT approximate language: "around 70kg", "about 25 years", "roughly 175cm" - these are valid data.',
      'ACCEPT informal language: jokes, slang, indirect mentions - if meaning is clear.',
      'REJECT ambiguous assignments: "70 and 88" without context, unclear which number is which field.',
      'REJECT when you cannot determine what specific values refer to which fields.',
      'Examples of GOOD data to extract:',
      '  - "around 70kg" → weight: 70',
      '  - "maybe 25 years old" → age: 25', 
      '  - "I\'m like 175 or something" → height: 175',
      '  - "quarter century old" → age: 25',
      'Examples of BAD data to NOT extract:',
      '  - "70 and 88" → unclear which is age/weight',
      '  - "25, 175, 70" → unclear which number is which field',
      '  - Multiple possible interpretations without clear context',
      'If any clear data is found, set hasData=true and fill the clear fields.',
      'If no clear data is found, set hasData=false and data=null.',
      'Always provide a helpful, encouraging reply in the "reply" field.',
      'For dates, use ISO format (YYYY-MM-DD) when possible.',
      'Common intents: "register", "workout", "nutrition", "progress", "question", "chat".',
      'In the reply, acknowledge what was clearly understood (if any).',
      'In the reply, ask for clarification on ambiguous assignments or unclear references.',
      'In the reply, gently remind about missing fields that are still needed.',
      'Keep the reply friendly, encouraging, and conversational.',
      'Structure replies: acknowledge clear data → ask for clarification of ambiguous assignments → request missing fields.',
    ].join('\n- ');

    const domainContext = domainHint ? `\nDomain Context:\n${domainHint}\n` : '';
    
    const systemPrompt = 'You are a data extraction and response engine for a fitness coaching app. Extract only the specified fields while providing helpful responses.';
    
    const userPrompt = 'Message to analyze: ' +
      `${userMsg}${domainContext} ` +
      '## Fields to Extract ' +
      'Extract these specific fields if mentioned in the message: ' +
      `${fieldDescriptions} ` +
      '## Expected JSON Response Format ' +
      `${schemaText} ` +
      '## Extraction Rules ' +
      `- ${rules} ` +
      '## Response Generation Guidelines ' +
      '**For the "reply" field, follow this structure:** ' +
      '1. **Acknowledge** what was successfully understood: "Great! I see that you\'re [age] years old..." ' +
      '2. **Ask for clarification** on ambiguous data: "Could you clarify your height? You mentioned [ambiguous value]..." ' +
      '3. **Remind about missing fields** (if any): "I still need to know about [missing fields] to help you better." ' +
      '4. **Stay encouraging**: Use positive, supportive language throughout. ' +
      '**Examples of extraction logic:** ' +
      'EXTRACT these (clear meaning despite informal language): ' +
      '- "I\'m around 25 years old" → extract age: 25 ' +
      '- "Maybe 70kg or so" → extract weight: 70 ' +
      '- "About 175cm tall" → extract height: 175 ' +
      '- "I\'m like a quarter century old" → extract age: 25 ' +
      '- "Weigh somewhere around 70 kilos" → extract weight: 70 ' +
      'DO NOT EXTRACT these (ambiguous assignments): ' +
      '- "70 and 88" → unclear which is age/weight, ask: "Could you clarify which number is your age and which is your weight?" ' +
      '- "25, 175, 70" → unclear field assignments, ask: "Could you tell me which number is your age, height, and weight?" ' +
      '- "I\'m 1988 and 70" → could be birth year + weight OR age + weight, ask for clarification ' +
      '**Examples of good replies:** ' +
      '- Clear data: "Great! I\'ve got your age (25) and approximate weight (70kg). What\'s your height and fitness goal?" ' +
      '- Ambiguous data: "Thanks! When you said \'70 and 88\', could you clarify which number is your age and which is your weight?" ' +
      '- Mixed data: "Perfect! I recorded your age (25). For the \'70 and 88\' you mentioned, could you tell me which is your weight and which might be your height?" ' +
      '**IMPORTANT**: Look for the fields listed above in the user message. Extract values and put them in the "fields" object with exact field names. ' +
      '**Respond with valid JSON only**:';

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * Enhanced version with context about already collected data and required fields
   * @param userMsg - User's input message to analyze
   * @param config - Enhanced configuration with field descriptions and context
   * @param domainHint - Optional domain context for better understanding
   */
  buildEnhancedDataParsingPrompt(
    userMsg: string,
    config: EnhancedDataParsingConfig,
    domainHint?: string,
  ): ChatMsg[] {
    const { fieldsConfig, alreadyCollected = {}, requiredFields = [], optionalFields = [] } = config;

    // Filter out already collected fields - only ask for missing ones
    const missingFieldsConfig: DataFieldsConfig = {};
    Object.entries(fieldsConfig).forEach(([key, description]) => {
      if (!Object.prototype.hasOwnProperty.call(alreadyCollected, key)) {
        missingFieldsConfig[key] = description;
      }
    });

    // If no fields are missing, return simple response
    if (Object.keys(missingFieldsConfig).length === 0) {
      const systemPrompt = 'You are a helpful fitness coach AI. The user\'s profile is complete.';
      const userPrompt = `User message: ${userMsg} ` +
        'All required profile information is already collected. Respond with: ' +
        '{ ' +
        '  "hasData": false, ' +
        '  "data": null, ' +
        '  "reply": "Great! Your profile is complete. How can I help you with your fitness journey today?" ' +
        '}';

      return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
    }

    // Generate field descriptions for missing fields only
    const fieldDescriptions = Object.entries(missingFieldsConfig)
      .map(([key, description]) => {
        const isRequired = requiredFields.includes(key);
        const isOptional = optionalFields.includes(key);
        
        let status = '';
        if (isRequired) {status = ' ⚠️ (required)';}
        else if (isOptional) {status = ' 💡 (optional)';}
        
        return `  "${key}": ${description}${status}`;
      })
      .join('\n');

    // Generate missing required fields (from the missing fields only)
    const missingRequired = requiredFields.filter(field => 
      !Object.prototype.hasOwnProperty.call(alreadyCollected, field) && 
      Object.prototype.hasOwnProperty.call(missingFieldsConfig, field),
    );
    const missingRequiredText = missingRequired.length > 0
      ? `\n## Still Need (Required)\n${missingRequired.map(field => `- ${field}: ${missingFieldsConfig[field]}`).join('\n')}\n`
      : '';

    // Generate expected fields structure for schema (missing fields only)
    const expectedFields = Object.entries(missingFieldsConfig)
      .map(([key, description]) => `    "${key}": any // ${description}`)
      .join(',\n');

    const schemaText = '{ ' +
      '  "hasData": boolean, ' +
      '  "data": { ' +
      '    "date"?: string, ' +
      '    "intent"?: string, ' +
      '    "fields"?: { ' +
      `${expectedFields} ` +
      '    } ' +
      '  } | null, ' +
      '  "reply": string ' +
      '}';

    const enhancedRules = [
      'Return ONLY valid JSON matching the schema. No prose or explanation.',
      'CRITICAL: Extract NEW data only when you can CLEARLY identify what each value represents.',
      'ACCEPT approximate language: "around 70kg", "about 25 years", "roughly 175cm" - these are valid data.',
      'ACCEPT informal language: jokes, slang, indirect mentions - if meaning is clear.',
      'REJECT ambiguous assignments: "70 and 88" without context, unclear which number is which field.',
      'REJECT when you cannot determine what specific values refer to which fields.',
      'Examples of GOOD NEW data to extract:',
      '  - "around 70kg" → weight: 70',
      '  - "maybe 25 years old" → age: 25', 
      '  - "I\'m like 175 or something" → height: 175',
      'Examples of BAD NEW data to NOT extract:',
      '  - "70 and 88" → unclear which is age/weight/height',
      '  - "25, 175, 70" → unclear which number is which field',
      'If any clear NEW data is found, set hasData=true and fill only the clear fields.',
      'If no clear NEW data is found, set hasData=false and data=null.',
      'In the reply, acknowledge any new clear information understood.',
      'In the reply, ask for clarification on ambiguous assignments or unclear references.',
      'In the reply, prioritize asking for REQUIRED missing fields first.',
      'In the reply, mention optional fields only if all required fields are collected.',
      'Keep the reply encouraging and mention progress made so far.',
      'Use friendly, conversational tone as a fitness coach.',
      'Structure replies: acknowledge clear new data → clarify ambiguous assignments → request missing required → mention optional.',
    ].join('\n- ');

    const domainContext = domainHint ? `\nDomain Context: ${domainHint}\n` : '';
    
    const systemPrompt = 'You are a helpful fitness coach AI that extracts data while providing encouraging, contextual responses based on what information is already collected.';
    
    const userPrompt = 'Message to analyze: ' +
      `${userMsg}${domainContext}${missingRequiredText} ` +
      '## Fields to Extract ' +
      `${fieldDescriptions} ` +
      '## Expected JSON Response Format ' +
      `${schemaText} ` +
      '## Enhanced Extraction Rules ' +
      `- ${enhancedRules} ` +
      '**Respond with valid JSON only**:';

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
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

    return 'Extract specific information from the user\'s message. ' +
      'Be very careful and accurate. If information is unclear or ambiguous, use null. ' +
      'Fields to extract: ' +
      `  ${fieldDescriptions} ` +
      'Rules: ' +
      '- Extract only explicitly mentioned information ' +
      '- If you\'re not confident about a value, use null ' +
      '- Respect field types and validation rules ' +
      '- For enum fields, use only the specified values or null ' +
      '- For number fields, ensure values are reasonable ' +
      'Return ONLY a JSON object with this exact structure: ' +
      '{ ' +
      `${expectedKeys} ` +
      '} ' +
      `User message: "${text}"`;
  }

  private getExpectedTypeString(field: FieldDefinition): string {
    switch (field.type) {
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'enum':
        return `"${field.enumValues?.join('"|"') ?? 'string'}"`;  
      case 'string':
      default:
        return 'string';
    }
  }

  /**
   * Question for fitness level determination
   */
  buildFitnessLevelQuestion(): string {
    return 'Now let\'s determine your fitness level. Which option best describes you: ' +
      '• Beginner - I have little or no regular exercise experience ' +
      '• Intermediate - I\'ve been exercising regularly for 1-2 years ' +
      '• Advanced - I\'ve been exercising regularly for more than 2 years ' +
      'Please reply with just one word: beginner, intermediate, or advanced.';
  }

  /**
   * Question for fitness goals
   */
  buildGoalQuestion(): string {
    return 'What is your main fitness goal? ' +
      '• Weight loss - lose weight and burn fat ' +
      '• Muscle gain - build muscle mass ' +
      '• Maintain - keep current fitness level ' +
      '• General fitness - improve overall health ' +
      '• Strength - increase strength and power ' +
      'Please reply with one of these options or describe your own goal.';
  }

  /**
   * Confirmation prompt with collected data
   */
  buildConfirmationPrompt(profileData: ParsedProfileData): string {
    const dataSummary = [
      profileData.age ? `Age: ${profileData.age} years` : 'Age: not specified',
      profileData.gender ? `Gender: ${profileData.gender === 'male' ? 'male' : 'female'}` : 'Gender: not specified',
      profileData.height ? `Height: ${profileData.height} cm` : 'Height: not specified',
      profileData.weight ? `Weight: ${profileData.weight} kg` : 'Weight: not specified',
      profileData.fitnessLevel ? `Level: ${profileData.fitnessLevel}` : 'Level: not specified',
      profileData.fitnessGoal ? `Goal: ${profileData.fitnessGoal}` : 'Goal: not specified',
    ].join('\n');

    return 'Let\'s review the information I\'ve collected: ' +
      `${dataSummary} ` +
      'Is this information correct? Reply with: ' +
      '• "yes" - to confirm and complete registration ' +
      '• "no" - to make corrections ' +
      '• "edit [field]" - to change a specific field (for example: "edit age")';
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
      'fitnessGoal': 'fitness goal',
    };

    const readableFields = missingFields.map(field => fieldNames[field] || field).join(', ');

    return `I need more information about: ${readableFields}. ` +
      'Please provide this information more clearly. For example: ' +
      '• Age: "I am 28 years old" or "28" ' +
      '• Height: "175 cm" or "5 feet 9 inches" ' +
      '• Weight: "75 kg" or "165 pounds"';
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
  buildGoalsSuccessMessage(goal: string, profileData: ParsedProfileData): string {
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
      'fitnessGoal': 'Goals',
    };

    const checklist = allFields.map(field => {
      const isCompleted = completedFields.includes(field);
      const status = isCompleted ? '✅' : '❌';
      return `${status} ${fieldNames[field]}`;
    }).join('\n');

    return `📋 Registration Progress:\n${checklist}`;
  }
}
