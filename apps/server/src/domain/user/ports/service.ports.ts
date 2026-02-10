import { ChatMsg } from '@domain/user/ports';
import { CreateUserInput, ParsedProfileData, User } from '@domain/user/services/user.service';

// DI Tokens for services
export const USER_SERVICE_TOKEN = Symbol('UserService');
export const REGISTRATION_SERVICE_TOKEN = Symbol('RegistrationService');
export const CHAT_SERVICE_TOKEN = Symbol('ChatService');

// Service interfaces - business logic contracts
export interface IUserService {
  upsertUser(data: CreateUserInput): Promise<User>;
  getUser(id: string): Promise<User | null>;
  updateProfileData(id: string, data: Partial<User>): Promise<User | null>;
  isRegistrationComplete(user: User): boolean;
}

export interface IRegistrationService {
  processUserMessage(user: User, message: string, historyMessages?: ChatMsg[]): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
  }>;
  checkProfileCompleteness(user: User): boolean;
}

export interface IChatService {
  processMessage(user: User, message: string, historyMessages?: ChatMsg[]): Promise<string>;
}
