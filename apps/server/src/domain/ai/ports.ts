import { ChatMsg } from '@domain/user/ports';

import type { Logger } from '@shared/logger';

// DI Tokens - using unique symbols for type safety
export const LLM_SERVICE_TOKEN = Symbol('LLMService');
export const AI_CONTEXT_SERVICE_TOKEN = Symbol('AIContextService');

// Port interfaces - domain contracts
export interface LLMService {
  generateWithSystemPrompt(
    messages: ChatMsg[],
    systemPrompt: string,
    opts?: { jsonMode?: boolean; log?: Logger },
  ): Promise<string>;

  /**
   * Generate response with structured output enforced by JSON Schema
   * @param messages - Chat messages
   * @param systemPrompt - System prompt
   * @param schema - Zod schema for structured output
   * @param opts - Optional logger for request context
   * @returns Parsed object matching the schema
   */
  generateStructured<T>(
    messages: ChatMsg[],
    systemPrompt: string,
    schema: unknown,
    opts?: { log?: Logger },
  ): Promise<T>;
}

export interface AIContextService {
  buildContext(user: unknown, conversation: ChatMsg[]): Promise<string>;
  extractUserIntent(message: string): Promise<string>;
  generatePersonalizedResponse(user: unknown, message: string): Promise<string>;
}
