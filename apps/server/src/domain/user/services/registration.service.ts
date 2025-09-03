import { User, ParsedProfileData } from './user.service';
import { IProfileParserService } from './profile-parser.service';
import { IPromptService, FieldDefinition, UniversalParseRequest } from './prompt.service';
import { USER_MESSAGES } from './messages';

export interface IRegistrationService {
  processUserMessage(user: User, message: string): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
  }>;
  getRegistrationPrompt(user: User): string;
  checkProfileCompleteness(user: User): boolean;
}

export class RegistrationService implements IRegistrationService {
  constructor(
    private readonly profileParser: IProfileParserService,
    private readonly userService: any, // Will be injected via DI
    private readonly promptService: IPromptService
  ) {}

  async processUserMessage(user: User, message: string): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
  }> {
    const currentStep = user.profileStatus || 'incomplete';
    const parsedData = await this.profileParser.parseProfileData(message);

    // Process based on current step
    switch (currentStep) {
      case 'incomplete':
        return await this.handleGreeting(user, message, parsedData);

      case 'collecting_basic':
        return await this.handleBasicInfo(user, message, parsedData);

      case 'collecting_level':
        return await this.handleFitnessLevel(user, message, parsedData);

      case 'collecting_goals':
        return await this.handleGoals(user, message, parsedData);

      case 'confirmation':
        return await this.handleConfirmation(user, message);

      case 'complete':
        return {
          updatedUser: user,
          response: USER_MESSAGES.PROFILE_COMPLETE,
          isComplete: true
        };

      default:
        return await this.handleGreeting(user, message, parsedData);
    }
  }

  private async handleGreeting(user: User, message: string, parsedData: ParsedProfileData): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
  }> {
    // Greeting and transition to basic info collection
    const newStatus = 'collecting_basic';

    // Update user status
    const updatedUser = {
      ...user,
      profileStatus: newStatus
    };

    const response = this.promptService.buildWelcomeMessage();

    return {
      updatedUser,
      response,
      isComplete: false
    };
  }

  private async handleBasicInfo(user: User, message: string, parsedData: ParsedProfileData): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
  }> {
    // Collect basic information (age, gender, height, weight)

    // Update user with any available data
    const updatedUser = {
      ...user,
      age: parsedData.age || user.age,
      gender: parsedData.gender || user.gender,
      height: parsedData.height || user.height,
      weight: parsedData.weight || user.weight
    };

    // Check if we have enough data to proceed to next step
    const hasAnyData = parsedData.age || parsedData.gender || parsedData.height || parsedData.weight;
    const hasAllData = updatedUser.age && updatedUser.gender && updatedUser.height && updatedUser.weight;

    if (hasAllData) {
      // All data collected, proceed to fitness level determination
      const newStatus = 'collecting_level';
      const finalUser = {
        ...updatedUser,
        profileStatus: newStatus
      };

      const response = this.promptService.buildBasicInfoSuccessMessage(
        updatedUser.age!,
        updatedUser.gender!,
        updatedUser.height!,
        updatedUser.weight!
      );

      return {
        updatedUser: finalUser,
        response,
        isComplete: false
      };
    } else if (hasAnyData) {
      // Some data collected, acknowledge and ask for missing data
      const missing = [];
      if (!updatedUser.age) missing.push('age');
      if (!updatedUser.gender) missing.push('gender');
      if (!updatedUser.height) missing.push('height');
      if (!updatedUser.weight) missing.push('weight');

      const response = `Thanks for the information I've collected so far. I still need: ${missing.join(', ')}.

Please provide the missing information:
• Age (if not provided): How old are you?
• Gender (if not provided): Are you male or female?
• Height (if not provided): What's your height in cm?
• Weight (if not provided): What's your weight in kg?`;

      return {
        updatedUser,
        response,
        isComplete: false
      };
    } else {
      // No data found, ask again
      const response = this.promptService.buildWelcomeMessage();

      return {
        updatedUser: user,
        response,
        isComplete: false
      };
    }
  }

  private async handleFitnessLevel(user: User, message: string, parsedData: ParsedProfileData): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
  }> {
    // Determine fitness level

    if (parsedData.fitnessLevel) {
      const newStatus = 'collecting_goals';
      const updatedUser = {
        ...user,
        profileStatus: newStatus,
        fitnessLevel: parsedData.fitnessLevel
      };

      const response = this.promptService.buildFitnessLevelSuccessMessage(parsedData.fitnessLevel!);

      return {
        updatedUser,
        response,
        isComplete: false
      };
    } else {
      const response = this.promptService.buildFitnessLevelQuestion();

      return {
        updatedUser: user,
        response,
        isComplete: false
      };
    }
  }

  private async handleGoals(user: User, message: string, parsedData: ParsedProfileData): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
  }> {
    // Collect fitness goals

    // Update user with any available goal data
    const updatedUser = {
      ...user,
      fitnessGoal: parsedData.fitnessGoal || user.fitnessGoal
    };

    if (parsedData.fitnessGoal) {
      // Goal collected, proceed to confirmation
      const newStatus = 'confirmation';
      const finalUser = {
        ...updatedUser,
        profileStatus: newStatus
      };

      const response = this.promptService.buildGoalsSuccessMessage(parsedData.fitnessGoal!, {
        age: user.age,
        gender: user.gender,
        height: user.height,
        weight: user.weight,
        fitnessLevel: user.fitnessLevel,
        fitnessGoal: parsedData.fitnessGoal
      });

      return {
        updatedUser: finalUser,
        response,
        isComplete: false
      };
    } else {
      const response = this.promptService.buildGoalQuestion();

      return {
        updatedUser: user,
        response,
        isComplete: false
      };
    }
  }

  private async handleConfirmation(user: User, message: string): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
  }> {
    const normalizedMessage = message.toLowerCase().trim();

    // Check if profile is complete before allowing confirmation
    const hasAllRequiredData = user.age && user.gender && user.height && user.weight && user.fitnessLevel && user.fitnessGoal;

    if (!hasAllRequiredData) {
      const missing = [];
      if (!user.age) missing.push('age');
      if (!user.gender) missing.push('gender');
      if (!user.height) missing.push('height');
      if (!user.weight) missing.push('weight');
      if (!user.fitnessLevel) missing.push('fitness level');
      if (!user.fitnessGoal) missing.push('fitness goal');

      const response = `I still need the following information before we can complete your registration: ${missing.join(', ')}.

Please go back and provide the missing information. Reply with "edit [field]" to change a specific field, or provide the missing information now.`;

      return {
        updatedUser: user,
        response,
        isComplete: false
      };
    }

    if (normalizedMessage === 'yes' || normalizedMessage === 'да' || normalizedMessage === 'confirm' ||
        normalizedMessage.includes('yes') || normalizedMessage.includes('correct') ||
        normalizedMessage.includes('верно') || normalizedMessage.includes('подтвердить')) {
      // Confirmation - complete registration
      const newStatus = 'complete';
      const updatedUser = {
        ...user,
        profileStatus: newStatus
      };

      const response = this.promptService.buildRegistrationCompleteMessage();

      return {
        updatedUser,
        response,
        isComplete: true
      };
    } else if (normalizedMessage.includes('edit') || normalizedMessage.includes('change') ||
               normalizedMessage.includes('исправить') || normalizedMessage.includes('изменить')) {
      // Return to previous step
      const newStatus = 'collecting_basic';
      const updatedUser = {
        ...user,
        profileStatus: newStatus
      };

      const response = this.promptService.buildProfileResetMessage();

      return {
        updatedUser,
        response,
        isComplete: false
      };
    } else {
      const response = this.promptService.buildConfirmationNeededMessage();

      return {
        updatedUser: user,
        response,
        isComplete: false
      };
    }
  }

  getRegistrationPrompt(user: User): string {
    const currentStep = user.profileStatus || 'incomplete';

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
  async parseWithUniversalParser(text: string): Promise<any> {
    // Define fields to extract
    const fields: FieldDefinition[] = [
      {
        key: 'age',
        description: 'User age in years',
        type: 'number',
        validation: { min: 10, max: 100 }
      },
      {
        key: 'gender',
        description: 'User gender',
        type: 'enum',
        enumValues: ['male', 'female']
      },
      {
        key: 'height',
        description: 'Height in centimeters',
        type: 'number',
        validation: { min: 120, max: 220 }
      },
      {
        key: 'weight',
        description: 'Weight in kilograms',
        type: 'number',
        validation: { min: 30, max: 200 }
      },
      {
        key: 'fitnessLevel',
        description: 'Fitness experience level',
        type: 'enum',
        enumValues: ['beginner', 'intermediate', 'advanced']
      },
      {
        key: 'preferredTime',
        description: 'Preferred workout time of day',
        type: 'enum',
        enumValues: ['morning', 'afternoon', 'evening']
      },
      {
        key: 'hasEquipment',
        description: 'Whether user has access to gym equipment',
        type: 'boolean'
      },
      {
        key: 'experience',
        description: 'Years of training experience',
        type: 'number',
        validation: { min: 0, max: 50 }
      }
    ];

    // Create universal parsing request
    const request: UniversalParseRequest = {
      text,
      fields
    };

    // Parse using universal method
    const result = await this.profileParser.parseUniversal(request);

    return result;
  }
}
