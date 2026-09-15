import { ChatMsg } from '@domain/ai/types';

import type { Logger } from '@shared/logger';

export const LLM_SERVICE_TOKEN = Symbol('LLMService');

// Temporary bridge while this file still shadows the `ports/` directory (deleted in refactor P1
// Task 5, together with LLMService): lets consumers import the gateway port through
// `@domain/ai/ports` as the import-boundary rule requires.
export * from './ports/llm.gateway.ports';

export interface LLMService {
  generateWithSystemPrompt(
    messages: ChatMsg[],
    systemPrompt: string,
    opts?: { jsonMode?: boolean; log?: Logger },
  ): Promise<string>;
}
