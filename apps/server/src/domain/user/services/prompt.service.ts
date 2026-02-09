import { ChatMsg, DataFieldsConfig, EnhancedDataParsingConfig, FieldDefinition, IPromptService, UniversalParseRequest } from '@domain/user/ports';
import { USER_MESSAGES } from '@domain/user/services/messages';
import { getStepConfig } from '@domain/user/services/registration.config';
import { FIELD_HINTS } from '@domain/user/services/registration.validation';
import { ParsedProfileData, User } from '@domain/user/services/user.service';

export class PromptService implements IPromptService {
  /**
   * System prompt for registration mode
   */
  buildRegistrationSystemPrompt(context?: string): string {
    const ctx = context ?? 'Starting profile registration. No data collected yet.';
    return 'You are a friendly AI fitness coach helping users complete their profile registration. ' +
      'CRITICAL: Use ONLY the context below. Do NOT ask for any field that is already collected. ' +
      'Show the user what we already have, then ask ONLY for the next missing field (one at a time). ' +
      'If everything for the current step is collected, move on or confirm. ' +
      'Keep responses brief and friendly. Always respond in English. ' +
      `\n\nCurrent registration context:\n${ctx}`;
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
      'CRITICAL: The user may write in ANY language (e.g. Russian, English). Extract age, gender, height (cm), weight (kg) from the message. Russian examples: "мне X лет" = age X, "мужчина"/"я мужчина" = male, "женщина" = female, "рост X" = height X cm, "вес X" = weight X kg.',
      'CRITICAL: Extract NEW data only when you can CLEARLY identify what each value represents.',
      'ACCEPT approximate language: "around 70kg", "about 25 years", "roughly 175cm" - these are valid data.',
      'ACCEPT informal language: jokes, slang, indirect mentions - if meaning is clear.',
      'REJECT ambiguous assignments: "70 and 88" without context, unclear which number is which field.',
      'REJECT when you cannot determine what specific values refer to which fields.',
      'Examples of GOOD NEW data to extract:',
      '  - "мне 30 лет, я мужчина, рост 178, вес 74" → age: 30, gender: "male", height: 178, weight: 74',
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

  /** Ask user to correct invalid field values (with hints). */
  buildInvalidFieldsMessage(invalidFields: string[]): string {
    return USER_MESSAGES.INVALID_FIELDS(invalidFields, FIELD_HINTS as Record<string, string>);
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

  buildRegistrationContext(user: User): string {
    const parts: string[] = [];
    if (user.age != null) { parts.push(`age=${user.age}`); }
    if (user.gender) { parts.push(`gender=${user.gender}`); }
    if (user.height != null) { parts.push(`height=${user.height}`); }
    if (user.weight != null) { parts.push(`weight=${user.weight}`); }
    if (user.fitnessLevel) { parts.push(`fitnessLevel=${user.fitnessLevel}`); }
    if (user.fitnessGoal) { parts.push(`fitnessGoal=${user.fitnessGoal}`); }

    const already = parts.length > 0 ? `Already collected: ${parts.join(', ')}.` : 'No data collected yet.';
    const stepConfig = getStepConfig(user.profileStatus);

    if (!stepConfig) {
      return already;
    }

    if (stepConfig.id === 'incomplete' || stepConfig.id === 'collecting_basic') {
      const need: string[] = [];
      if (user.age == null) {need.push('age');}
      if (!user.gender) {need.push('gender');}
      if (user.height == null) {need.push('height');}
      if (user.weight == null) {need.push('weight');}
      const still = need.length > 0 ? ` Still need: ${need.join(', ')}. Ask only for the next missing field.` : ' Basic info complete.';
      return `${already}${still}`;
    }
    if (stepConfig.id === 'collecting_level') {
      return `${already} Current step: fitness level. Still need: fitness level ` +
        '(beginner/intermediate/advanced). Ask only for fitness level.';
    }
    if (stepConfig.id === 'collecting_goals') {
      return `${already} Current step: goals. Still need: fitness goal. Ask only for goal.`;
    }
    if (stepConfig.id === 'confirmation') {
      return `${already} All data collected. Ask user to confirm (yes/edit).`;
    }
    return already;
  }

  buildReaskBasicInfoMessage(user: User): string {
    const have: string[] = [];
    if (user.age != null) {have.push(`Age: ${user.age}`);}
    if (user.gender) {have.push(`Gender: ${user.gender}`);}
    if (user.height != null) {have.push(`Height: ${user.height} cm`);}
    if (user.weight != null) {have.push(`Weight: ${user.weight} kg`);}

    const missing: string[] = [];
    if (user.age == null) {missing.push('age');}
    if (!user.gender) {missing.push('gender');}
    if (user.height == null) {missing.push('height');}
    if (user.weight == null) {missing.push('weight');}

    if (missing.length === 0) {
      return USER_MESSAGES.BASIC_INFO_SUCCESS(
        user.age!,
        user.gender!,
        user.height!,
        user.weight!,
      );
    }

    const alreadyLine = have.length > 0
      ? `I already have: ${have.join(', ')}.\n\n`
      : '';
    const nextOnly: Record<string, string> = {
      age: 'How old are you?',
      gender: 'What is your gender (male/female)?',
      height: 'What is your height in cm?',
      weight: 'What is your weight in kg?',
    };
    const [next] = missing;
    return `${alreadyLine}I still need: ${missing.join(', ')}.\n\n${nextOnly[next] ?? `Please provide: ${next}.`}`;
  }
}
