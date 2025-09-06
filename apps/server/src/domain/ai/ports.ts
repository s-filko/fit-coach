import { ChatMsg } from '@domain/user/services/prompt.service';

export interface LLMRequest {
  id: string;
  timestamp: Date;
  message: string;
  isRegistration: boolean;
  context?: string;
  systemPrompt?: string;
  model: string;
  temperature: number;
}

export interface LLMResponse {
  id: string;
  timestamp: Date;
  requestId: string;
  content: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  processingTime: number;
}

// DI Tokens - using unique symbols for type safety
export const LLM_SERVICE_TOKEN = Symbol('LLMService');
export const AI_CONTEXT_SERVICE_TOKEN = Symbol('AIContextService');

// Port interfaces - domain contracts
export interface LLMService {
  generateResponse(message: ChatMsg[], isRegistration?: boolean): Promise<string>;
  generateRegistrationResponse(message: ChatMsg[], context?: string): Promise<string>;
  
  // Debug methods
  getDebugInfo(): {
    model: string;
    temperature: number;
    isDebugMode: boolean;
    requestHistory: LLMRequest[];
    responseHistory: LLMResponse[];
  };
  enableDebugMode(): void;
  disableDebugMode(): void;
  clearHistory(): void;
}

export interface AIContextService {
  buildContext(user: unknown, conversation: ChatMsg[]): Promise<string>;
  extractUserIntent(message: string): Promise<string>;
  generatePersonalizedResponse(user: unknown, message: string): Promise<string>;
}
