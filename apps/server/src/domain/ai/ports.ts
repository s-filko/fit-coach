import { ChatMsg } from '@domain/user/ports';

export interface LLMRequest {
  id: string;
  timestamp: Date;
  message: string;
  isRegistration: boolean;
  context?: string;
  systemPrompt?: string;
  model: string;
  temperature: number;
  jsonMode?: boolean;
  httpPayload?: unknown; // Full HTTP request payload for debugging
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
  error?: string; // Error message if request failed
  providerError?: string; // Specific error message from LLM provider (OpenAI/OpenRouter)
  httpResponse?: unknown; // Full HTTP response metadata for debugging
}

// DI Tokens - using unique symbols for type safety
export const LLM_SERVICE_TOKEN = Symbol('LLMService');
export const AI_CONTEXT_SERVICE_TOKEN = Symbol('AIContextService');

// Port interfaces - domain contracts
export interface LLMService {
  generateWithSystemPrompt(messages: ChatMsg[], systemPrompt: string, opts?: { jsonMode?: boolean }): Promise<string>;

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
