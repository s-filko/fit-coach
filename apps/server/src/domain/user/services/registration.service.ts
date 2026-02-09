import { LLMService } from '@domain/ai/ports';
import {
  ChatMsg,
  IProfileParserService,
  IPromptService,
  IRegistrationService,
} from '@domain/user/ports';

import { USER_MESSAGES } from './messages';
import { getStepConfig } from './registration.config';
import { validateStepData } from './registration.validation';
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
    const currentStep = (user.profileStatus ?? 'incomplete');
    const parsedData = await this.profileParser.parseProfileData(user, message);

    const stepConfig = getStepConfig(currentStep);

    if (currentStep === 'complete' || !stepConfig) {
      return {
        updatedUser: user,
        response: USER_MESSAGES.PROFILE_COMPLETE,
        isComplete: true,
      };
    }

    switch (stepConfig.id) {
      case 'incomplete':
        return await this.handleGreeting(user, message, parsedData);

      case 'collecting_basic':
        return await this.handleBasicInfo(user, message, parsedData);

      case 'collecting_level':
        if (parsedData.gender || parsedData.age || parsedData.height || parsedData.weight) {
          return await this.handleBasicInfo(user, message, parsedData);
        }
        return await this.handleFitnessLevel(user, message, parsedData);

      case 'collecting_goals':
        return await this.handleGoals(user, message, parsedData);

      case 'confirmation':
        return await this.handleConfirmation(user, message);

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
    const stepConfig = getStepConfig('incomplete');
    const newStatus = stepConfig?.nextStep ?? 'collecting_basic';
    const updatedUser = { ...user, profileStatus: newStatus };

    const context = this.promptService.buildRegistrationContext(user);
    const chatMessage: ChatMsg[] = [{ role: 'user', content: message }];
    const response = await this.llmService.generateRegistrationResponse(chatMessage, context);

    return { updatedUser, response, isComplete: false, parsedData };
  }

  private async handleBasicInfo(user: User, message: string, parsedData: ParsedProfileData): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
  }> {
    const merged = {
      ...user,
      age: parsedData.age ?? user.age,
      gender: parsedData.gender ?? user.gender,
      height: parsedData.height ?? user.height,
      weight: parsedData.weight ?? user.weight,
    };
    const { validData, invalidFields, missingFields, isComplete } = validateStepData('collecting_basic', merged);
    const updatedUser = { ...user, ...validData } as User;

    if (invalidFields.length > 0) {
      return {
        updatedUser,
        response: this.promptService.buildInvalidFieldsMessage(invalidFields),
        isComplete: false,
        parsedData,
      };
    }

    if (isComplete) {
      const stepConfig = getStepConfig('collecting_basic');
      const newStatus = stepConfig?.nextStep ?? 'collecting_level';
      const finalUser = { ...updatedUser, profileStatus: newStatus };
      const response = this.promptService.buildBasicInfoSuccessMessage(
        updatedUser.age!,
        updatedUser.gender!,
        updatedUser.height!,
        updatedUser.weight!,
      );
      return { updatedUser: finalUser, response, isComplete: false, parsedData };
    }

    if (missingFields.length > 0) {
      const hasAnyNewData = parsedData.age ?? parsedData.gender ?? parsedData.height ?? parsedData.weight;
      const response = hasAnyNewData
        ? USER_MESSAGES.PARTIAL_INFO_CLARIFICATION(missingFields)
        : this.promptService.buildReaskBasicInfoMessage(updatedUser);
      return { updatedUser, response, isComplete: false, parsedData };
    }

    return {
      updatedUser,
      response: this.promptService.buildReaskBasicInfoMessage(updatedUser),
      isComplete: false,
      parsedData,
    };
  }

  private async handleFitnessLevel(user: User, message: string, parsedData: ParsedProfileData): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
  }> {
    const context = this.promptService.buildRegistrationContext(user);
    const chatMessage: ChatMsg[] = [{ role: 'user', content: message }];
    const llmResponse = await this.llmService.generateRegistrationResponse(chatMessage, context);

    const merged = { ...user, fitnessLevel: parsedData.fitnessLevel ?? user.fitnessLevel };
    const { validData, invalidFields, missingFields, isComplete } = validateStepData('collecting_level', merged);
    const updatedUser = { ...user, ...validData } as User;

    if (invalidFields.length > 0) {
      return {
        updatedUser,
        response: this.promptService.buildInvalidFieldsMessage(invalidFields),
        isComplete: false,
        parsedData,
      };
    }
    if (isComplete && validData.fitnessLevel) {
      const stepConfig = getStepConfig('collecting_level');
      const newStatus = stepConfig?.nextStep ?? 'collecting_goals';
      return {
        updatedUser: { ...updatedUser, profileStatus: newStatus },
        response: llmResponse,
        isComplete: false,
        parsedData,
      };
    }
    return {
      updatedUser: missingFields.length > 0 ? user : updatedUser,
      response: llmResponse,
      isComplete: false,
      parsedData,
    };
  }

  private async handleGoals(user: User, message: string, parsedData: ParsedProfileData): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
  }> {
    const context = this.promptService.buildRegistrationContext(user);
    const chatMessage: ChatMsg[] = [{ role: 'user', content: message }];
    const llmResponse = await this.llmService.generateRegistrationResponse(chatMessage, context);

    const merged = { ...user, fitnessGoal: parsedData.fitnessGoal ?? user.fitnessGoal };
    const { validData, invalidFields, isComplete } = validateStepData('collecting_goals', merged);
    const updatedUser = { ...user, ...validData } as User;

    if (invalidFields.length > 0) {
      return {
        updatedUser,
        response: this.promptService.buildInvalidFieldsMessage(invalidFields),
        isComplete: false,
        parsedData,
      };
    }
    if (isComplete && validData.fitnessGoal) {
      const stepConfig = getStepConfig('collecting_goals');
      const newStatus = stepConfig?.nextStep ?? 'confirmation';
      return {
        updatedUser: { ...updatedUser, profileStatus: newStatus },
        response: llmResponse,
        isComplete: false,
        parsedData,
      };
    }
    return {
      updatedUser,
      response: llmResponse,
      isComplete: false,
      parsedData,
    };
  }

  private async handleConfirmation(user: User, message: string): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
  }> {
    const normalizedMessage = message.toLowerCase().trim();

    const context = this.promptService.buildRegistrationContext(user);
    const chatMessage: ChatMsg[] = [{ role: 'user', content: message }];
    const response = await this.llmService.generateRegistrationResponse(chatMessage, context);

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
      const updatedUser = {
        ...user,
        profileStatus: 'complete',
      };

      return {
        updatedUser,
        response,
        isComplete: true,
      };
    } else if (normalizedMessage.includes('edit') || normalizedMessage.includes('change') ||
               normalizedMessage.includes('исправить') || normalizedMessage.includes('изменить')) {
      const updatedUser = {
        ...user,
        profileStatus: 'collecting_basic',
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

}
