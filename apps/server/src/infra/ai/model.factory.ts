import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

import { loadConfig } from '@config/index';

import { createLogger } from '@shared/logger';

const log = createLogger('llm');

class LLMLogHandler extends BaseCallbackHandler {
  name = 'LLMLogHandler';

  handleChatModelStart(
    _llm: Serialized,
    messages: BaseMessage[][],
    _runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): void {
    const flat = messages[0] ?? [];
    const system = flat.find(m => m._getType() === 'system');
    const systemLen = typeof system?.content === 'string' ? system.content.length : 0;
    const humanMsgs = flat.filter(m => m._getType() === 'human');
    const lastHuman = humanMsgs[humanMsgs.length - 1];
    const userId = (extraParams?.['configurable'] as Record<string, unknown>)?.['userId'] as string | undefined;

    log.debug(
      {
        userId,
        totalMessages: flat.length,
        systemPromptLength: systemLen,
        systemPromptPreview: typeof system?.content === 'string' ? system.content.slice(0, 300) : null,
        lastUserMessage: typeof lastHuman?.content === 'string' ? lastHuman.content.slice(0, 200) : null,
        historyCount: flat.length - (system ? 1 : 0) - (lastHuman ? 1 : 0),
      },
      'LLM invoke',
    );
  }

  handleLLMEnd(output: { generations: Array<Array<{ text: string }>> }): void {
    const text = output.generations?.[0]?.[0]?.text;
    log.debug(
      {
        responseLength: text?.length ?? 0,
        responsePreview: text?.slice(0, 300) ?? null,
      },
      'LLM response',
    );
  }
}

let _model: ChatOpenAI | null = null;

/**
 * Returns a shared ChatOpenAI instance configured from environment.
 * Replaces LLMService — model is used directly in graph nodes.
 */
export function getModel(): ChatOpenAI {
  if (_model) {
    return _model;
  }

  const config = loadConfig();

  _model = new ChatOpenAI({
    model: config.LLM_MODEL,
    temperature: config.LLM_TEMPERATURE,
    apiKey: config.LLM_API_KEY,
    configuration: config.LLM_API_URL ? { baseURL: config.LLM_API_URL } : undefined,
    callbacks: [new LLMLogHandler()],
  });

  return _model;
}
