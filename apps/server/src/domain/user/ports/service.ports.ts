import { User, CreateUserInput, ParsedProfileData } from '../services/user.service';
import { UniversalParseRequest, UniversalParseResult } from './prompt.ports';

// DI Tokens for services
export const USER_SERVICE_TOKEN = Symbol('UserService');
export const REGISTRATION_SERVICE_TOKEN = Symbol('RegistrationService');
export const PROFILE_PARSER_SERVICE_TOKEN = Symbol('ProfileParserService');

// Service interfaces - business logic contracts
export interface UserService {
  findByProvider(provider: string, providerUserId: string): Promise<User | null>;
  createUser(data: CreateUserInput): Promise<User>;
  getUserById(id: string): Promise<User | null>;
  updateUserProfile(id: string, data: Partial<User>): Promise<User | null>;
  upsertUser(data: CreateUserInput): Promise<User>;
  getUser(id: string): Promise<User | null>;
  updateProfileData(id: string, data: Partial<User>): Promise<User | null>;
  isRegistrationComplete(user: User): boolean;
}

export interface IRegistrationService {
  processUserMessage(user: User, message: string): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
  }>;
  getRegistrationPrompt(user: User): string;
  checkProfileCompleteness(user: User): boolean;
}

export interface IProfileParserService {
  parseProfileData(user: User, text: string): Promise<ParsedProfileData>;
  parseUniversal(request: UniversalParseRequest): Promise<UniversalParseResult>;
}
