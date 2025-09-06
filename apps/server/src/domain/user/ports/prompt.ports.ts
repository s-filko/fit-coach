import { ParsedProfileData } from '../services/user.service';

// Chat message interface for LLM interactions
export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Data parsing configuration interface
export interface DataFieldsConfig {
  [key: string]: string; // key: field name, value: description for LLM
}

// Enhanced data parsing configuration with context
export interface EnhancedDataParsingConfig {
  fieldsConfig: DataFieldsConfig;
  alreadyCollected?: { [key: string]: unknown }; // fields already collected
  requiredFields?: string[]; // fields that are required
  optionalFields?: string[]; // fields that are optional
}

// Field definition for universal parsing
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

// Universal parsing request interface
export interface UniversalParseRequest {
  text: string;
  fields: FieldDefinition[];
}

// Universal parsing result interface
export interface UniversalParseResult {
  [key: string]: unknown | null;
}

// DI Token for prompt service
export const PROMPT_SERVICE_TOKEN = Symbol('PromptService');

// Prompt service interface - specialized for prompt generation
export interface IPromptService {
  buildRegistrationSystemPrompt(context?: string): string;
  buildChatSystemPrompt(): string;
  buildProfileParsingPrompt(text: string, alreadyCollected: Partial<ParsedProfileData>): ChatMsg[];
  buildUniversalParsingPrompt(request: UniversalParseRequest): string;
  buildWelcomeMessage(): string;
  buildBasicInfoSuccessMessage(age: number, gender: string, height: number, weight: number): string;
  buildClarificationMessage(missingFields: string[]): string;
  buildFitnessLevelQuestion(): string;
  buildFitnessLevelSuccessMessage(level: string): string;
  buildGoalQuestion(): string;
  buildGoalsSuccessMessage(goal: string, profileData: ParsedProfileData): string;
  buildConfirmationPrompt(profileData: ParsedProfileData): string;
  buildRegistrationCompleteMessage(): string;
  buildProfileResetMessage(): string;
  buildConfirmationNeededMessage(): string;
  buildClarificationPrompt(missingFields: string[]): string;
  buildProgressChecklist(completedFields: string[]): string;
}
