import { User, CreateUserInput } from './services/user.service';

// DI Tokens - using unique symbols for type safety
export const USER_REPOSITORY_TOKEN = Symbol('UserRepository');
export const USER_SERVICE_TOKEN = Symbol('UserService');
export const REGISTRATION_SERVICE_TOKEN = Symbol('RegistrationService');
export const PROFILE_PARSER_SERVICE_TOKEN = Symbol('ProfileParserService');
export const PROMPT_SERVICE_TOKEN = Symbol('PromptService');

// Port interfaces - domain contracts
export interface UserRepository {
  findByProvider(provider: string, providerUserId: string): Promise<User | null>;
  create(data: CreateUserInput): Promise<User>;
  getById(id: string): Promise<User | null>;
  updateProfileData(id: string, data: Partial<User>): Promise<User | null>;
}

export interface UserService {
  findByProvider(provider: string, providerUserId: string): Promise<User | null>;
  createUser(data: CreateUserInput): Promise<User>;
  getUserById(id: string): Promise<User | null>;
  updateUserProfile(id: string, data: Partial<User>): Promise<User | null>;
}

export interface RegistrationService {
  processUserMessage(user: User, message: string): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: unknown;
  }>;
  getRegistrationPrompt(user: User): string;
  checkProfileCompleteness(user: User): boolean;
}

export interface ProfileParserService {
  parseProfileData(user: User, message: string): Promise<unknown>;
}

export interface PromptService {
  generatePrompt(request: unknown): Promise<string>;
}
