import { User } from '@domain/user/services/user.service';

// Chat message interface for LLM interactions
export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// DI Token for prompt service
export const PROMPT_SERVICE_TOKEN = Symbol('PromptService');

// Prompt service interface - specialized for prompt generation
export interface IPromptService {
  /** System prompt for unified registration: extract data + generate response in one LLM call */
  buildUnifiedRegistrationPrompt(user: User): string;
  /** System prompt for general chat mode (post-registration) */
  buildChatSystemPrompt(user: User): string;
}
