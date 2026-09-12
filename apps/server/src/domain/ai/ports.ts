import { ChatMsg } from '@domain/ai/types';

import type { Logger } from '@shared/logger';

export const LLM_SERVICE_TOKEN = Symbol('LLMService');

export interface LLMService {
  generateWithSystemPrompt(
    messages: ChatMsg[],
    systemPrompt: string,
    opts?: { jsonMode?: boolean; log?: Logger },
  ): Promise<string>;
}
