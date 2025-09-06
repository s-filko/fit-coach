import { LLMService } from '@domain/ai/ports';
import { 
  ChatMsg, 
  FieldDefinition, 
  IProfileParserService,
  IPromptService, 
  IRegistrationService, 
  UniversalParseRequest, 
  UniversalParseResult,
} from '@domain/user/ports';

import { USER_MESSAGES } from './messages';
import { ParsedProfileData, User } from './user.service';

export class RegistrationService implements IRegistrationService {
  constructor(
    private readonly profileParser: IProfileParserService,
    private readonly promptService: IPromptService,
    private readonly llmService: LLMService,
  ) {}

  async processUserMessage(user: User, message: string): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
  }> {

    const currentStep = user.profileStatus ?? 'incomplete';

    const parsedData = await this.profileParser.parseProfileData(user, message);

    // Process based on current step
    switch (currentStep) {
      case 'incomplete':
        return await this.handleGreeting(user, message, parsedData);

      case 'collecting_basic':
        return await this.handleBasicInfo(user, message, parsedData);

      case 'collecting_level':
        // If user is providing basic info (gender, age, etc.) during fitness level collection,
        // update the basic info first
        if (parsedData.gender || parsedData.age || parsedData.height || parsedData.weight) {
          return await this.handleBasicInfo(user, message, parsedData);
        }
        return await this.handleFitnessLevel(user, message, parsedData);

      case 'collecting_goals':
        return await this.handleGoals(user, message, parsedData);

      case 'confirmation':
        return await this.handleConfirmation(user, message);

      case 'complete':
        return {
          updatedUser: user,
          response: USER_MESSAGES.PROFILE_COMPLETE,
          isComplete: true,
        };

      default:
        return await this.handleGreeting(user, message, parsedData);
    }
  }

  private async handleGreeting(user: User, message: string, parsedData: ParsedProfileData): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
  }> {
    // Greeting and transition to basic info collection
    const newStatus = 'collecting_basic';

    // Update user status
    const updatedUser = {
      ...user,
      profileStatus: newStatus,
    };

    // Generate AI response based on current state
    const chatMessage: ChatMsg[] = [{ role: 'user', content: message }];
    const response = await this.llmService.generateResponse(chatMessage, true);

    return {
      updatedUser,
      response,
      isComplete: false,
      parsedData,
    };
  }

  private async handleBasicInfo(user: User, message: string, parsedData: ParsedProfileData): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
  }> {
    // Collect basic information (age, gender, height, weight)

    // Update user with any available data
    const updatedUser = {
      ...user,
      age: parsedData.age ?? user.age,
      gender: parsedData.gender ?? user.gender,
      height: parsedData.height ?? user.height,
      weight: parsedData.weight ?? user.weight,
    };

    // Check if we have enough data to proceed to next step
    const hasAnyData = parsedData.age ?? parsedData.gender ?? parsedData.height ?? parsedData.weight;
    const hasAllData = updatedUser.age && updatedUser.gender && updatedUser.height && updatedUser.weight;

    // Use the AI response from profile parser (which already contains the proper AI-generated response)
    // The profile parser's LLM response includes both data extraction and a helpful reply
    let response: string;

    if (hasAllData) {
      // All data collected, proceed to fitness level determination
      const newStatus = 'collecting_level';
      const finalUser = {
        ...updatedUser,
        profileStatus: newStatus,
      };

      response = this.promptService.buildBasicInfoSuccessMessage(
        updatedUser.age!,
        updatedUser.gender!,
        updatedUser.height!,
        updatedUser.weight!,
      );

      return {
        updatedUser: finalUser,
        response,
        isComplete: false,
        parsedData,
      };
    } else if (hasAnyData) {
      // Some data collected, acknowledge and ask for missing data
      const missing = [];
      if (!updatedUser.age) {missing.push('age');}
      if (!updatedUser.gender) {missing.push('gender');}
      if (!updatedUser.height) {missing.push('height');}
      if (!updatedUser.weight) {missing.push('weight');}

      response = USER_MESSAGES.PARTIAL_INFO_CLARIFICATION(missing);

      return {
        updatedUser,
        response,
        isComplete: false,
        parsedData,
      };
    } else {
      // No data found, ask again
      response = this.promptService.buildWelcomeMessage();

      return {
        updatedUser: user,
        response,
        isComplete: false,
        parsedData,
      };
    }
  }

  private async handleFitnessLevel(user: User, message: string, parsedData: ParsedProfileData): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
  }> {
    // Determine fitness level

    // Generate AI response based on current state
    const chatMessage: ChatMsg[] = [{ role: 'user', content: message }];
    const response = await this.llmService.generateResponse(chatMessage, true);

    if (parsedData.fitnessLevel) {
      const newStatus = 'collecting_goals';
      const updatedUser = {
        ...user,
        profileStatus: newStatus,
        fitnessLevel: parsedData.fitnessLevel,
      };

      return {
        updatedUser,
        response,
        isComplete: false,
        parsedData,
      };
    } else {
      return {
        updatedUser: user,
        response,
        isComplete: false,
        parsedData,
      };
    }
  }

  private async handleGoals(user: User, message: string, parsedData: ParsedProfileData): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
  }> {
    // Collect fitness goals

    // Generate AI response based on current state
    const chatMessage: ChatMsg[] = [{ role: 'user', content: message }];
    const response = await this.llmService.generateResponse(chatMessage, true);

    // Update user with any available goal data
    const updatedUser = {
      ...user,
      fitnessGoal: parsedData.fitnessGoal ?? user.fitnessGoal,
    };

    if (parsedData.fitnessGoal) {
      // Goal collected, proceed to confirmation
      const newStatus = 'confirmation';
      const finalUser = {
        ...updatedUser,
        profileStatus: newStatus,
      };

      return {
        updatedUser: finalUser,
        response,
        isComplete: false,
        parsedData,
      };
    } else {
      return {
        updatedUser: user,
        response,
        isComplete: false,
        parsedData,
      };
    }
  }

  private async handleConfirmation(user: User, message: string): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
  }> {
    const normalizedMessage = message.toLowerCase().trim();

    // Generate AI response based on current state
    const chatMessage: ChatMsg[] = [{ role: 'user', content: message }];
    const response = await this.llmService.generateResponse(chatMessage, true);

    // Check if profile is complete before allowing confirmation
    const hasAllRequiredData = user.age && user.gender && user.height && 
      user.weight && user.fitnessLevel && user.fitnessGoal;

    if (!hasAllRequiredData) {
      return {
        updatedUser: user,
        response,
        isComplete: false,
      };
    }

    if (normalizedMessage === 'yes' || normalizedMessage === 'да' || normalizedMessage === 'confirm' ||
        normalizedMessage.includes('yes') || normalizedMessage.includes('correct') ||
        normalizedMessage.includes('верно') || normalizedMessage.includes('подтвердить')) {
      // Confirmation - complete registration
      const newStatus = 'complete';
      const updatedUser = {
        ...user,
        profileStatus: newStatus,
      };

      return {
        updatedUser,
        response,
        isComplete: true,
      };
    } else if (normalizedMessage.includes('edit') || normalizedMessage.includes('change') ||
               normalizedMessage.includes('исправить') || normalizedMessage.includes('изменить')) {
      // Return to previous step
      const newStatus = 'collecting_basic';
      const updatedUser = {
        ...user,
        profileStatus: newStatus,
      };

      const response = this.promptService.buildProfileResetMessage();

      return {
        updatedUser,
        response,
        isComplete: false,
      };
    } else {
      const response = this.promptService.buildConfirmationNeededMessage();

      return {
        updatedUser: user,
        response,
        isComplete: false,
      };
    }
  }

  getRegistrationPrompt(user: User): string {
    const currentStep = user.profileStatus ?? 'incomplete';

    switch (currentStep) {
      case 'incomplete':
        return USER_MESSAGES.AI_PROMPT_INCOMPLETE;

      case 'collecting_basic':
        return USER_MESSAGES.AI_PROMPT_COLLECTING_BASIC;

      case 'collecting_level':
        return USER_MESSAGES.AI_PROMPT_COLLECTING_LEVEL;

      case 'collecting_goals':
        return USER_MESSAGES.AI_PROMPT_COLLECTING_GOALS;

      case 'confirmation':
        return USER_MESSAGES.AI_PROMPT_CONFIRMATION;

      case 'complete':
        return USER_MESSAGES.AI_PROMPT_COMPLETE;

      default:
        return USER_MESSAGES.AI_PROMPT_COMPLETE;
    }
  }

  checkProfileCompleteness(user: User): boolean {
    // Check if all required fields are present
    return !!(
      user.age &&
      user.gender &&
      user.height &&
      user.weight &&
      user.fitnessLevel &&
      user.fitnessGoal &&
      user.profileStatus === 'complete'
    );
  }

  /**
   * Example of using universal parser for flexible data extraction
   */
  async parseWithUniversalParser(text: string): Promise<UniversalParseResult> {
    // Define fields to extract
    const fields: FieldDefinition[] = [
      {
        key: 'age',
        description: 'User age in years',
        type: 'number',
        validation: { min: 10, max: 100 },
      },
      {
        key: 'gender',
        description: 'User gender',
        type: 'enum',
        enumValues: ['male', 'female'],
      },
      {
        key: 'height',
        description: 'Height in centimeters',
        type: 'number',
        validation: { min: 120, max: 220 },
      },
      {
        key: 'weight',
        description: 'Weight in kilograms',
        type: 'number',
        validation: { min: 30, max: 200 },
      },
      {
        key: 'fitnessLevel',
        description: 'Fitness experience level',
        type: 'enum',
        enumValues: ['beginner', 'intermediate', 'advanced'],
      },
      {
        key: 'preferredTime',
        description: 'Preferred workout time of day',
        type: 'enum',
        enumValues: ['morning', 'afternoon', 'evening'],
      },
      {
        key: 'hasEquipment',
        description: 'Whether user has access to gym equipment',
        type: 'boolean',
      },
      {
        key: 'experience',
        description: 'Years of training experience',
        type: 'number',
        validation: { min: 0, max: 50 },
      },
    ];

    // Create universal parsing request
    const request: UniversalParseRequest = {
      text,
      fields,
    };

    // Parse using universal method
    const result = await this.profileParser.parseUniversal(request);

    return result;
  }
}
