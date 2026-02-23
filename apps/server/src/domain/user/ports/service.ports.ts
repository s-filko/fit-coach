import { ChatMsg } from '@domain/user/ports';
import { CreateUserInput, ParsedProfileData, User } from '@domain/user/services/user.service';

import type { Logger } from '@shared/logger';

// DI Tokens for services
export const USER_SERVICE_TOKEN = Symbol('UserService');
export const REGISTRATION_SERVICE_TOKEN = Symbol('RegistrationService');

export interface IUserService {
  upsertUser(data: CreateUserInput): Promise<User>;
  getUser(id: string): Promise<User | null>;
  updateProfileData(id: string, data: Partial<User>): Promise<User | null>;
  isRegistrationComplete(user: User): boolean;
  needsRegistration(user: User): boolean;
}

export interface IRegistrationService {
  processUserMessage(
    user: User,
    message: string,
    historyMessages?: ChatMsg[],
    opts?: { log?: Logger },
  ): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
    phaseTransition?: { toPhase: 'chat' | 'plan_creation'; reason?: string };
  }>;
  checkProfileCompleteness(user: User): boolean;
}

