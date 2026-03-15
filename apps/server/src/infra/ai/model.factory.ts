import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

import { loadConfig } from '@config/index';

import { createLogger } from '@shared/logger';

const log = createLogger('llm');
const config = loadConfig();
const isDebug = config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace';

interface OpenAIMessage {
  role: string;
  content: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
}

function messageToOpenAI(msg: BaseMessage): OpenAIMessage {
  const type = msg._getType();
  let role: string;
  if (type === 'human') {
    role = 'user';
  } else if (type === 'ai') {
    role = 'assistant';
  } else {
    role = type;
  }
  const base: OpenAIMessage = { role, content: msg.content };
  if (type === 'ai' && 'tool_calls' in msg && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    base.tool_calls = msg.tool_calls;
  }
  if (type === 'tool' && 'tool_call_id' in msg) {
    base.tool_call_id = msg.tool_call_id as string;
  }
  return base;
}

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
    const humanMsgs = flat.filter(m => m._getType() === 'human');
    const lastHuman = humanMsgs[humanMsgs.length - 1];
    const options = extraParams?.['options'] as Record<string, unknown> | undefined;
    const userId = (options?.['configurable'] as Record<string, unknown>)?.['userId'] as string | undefined;

    if (isDebug) {
      const invocationParams = extraParams?.['invocation_params'] as Record<string, unknown> | undefined;
      const tools = options?.['tools'] as unknown[] | undefined;

      const openaiMessages = flat.map(messageToOpenAI);
      const replayPayload: Record<string, unknown> = {
        model: invocationParams?.['model'] ?? config.LLM_MODEL,
        messages: openaiMessages,
        temperature: invocationParams?.['temperature'] ?? config.LLM_TEMPERATURE,
      };
      if (tools && tools.length > 0) {
        replayPayload['tools'] = tools;
      }

      log.debug(
        {
          userId,
          totalMessages: flat.length,
          replayPayload,
        },
        'LLM invoke [debug]',
      );
    } else {
      log.debug(
        {
          userId,
          totalMessages: flat.length,
          systemPromptLength: typeof system?.content === 'string' ? system.content.length : 0,
          lastUserMessage: typeof lastHuman?.content === 'string' ? lastHuman.content : null,
          historyCount: flat.length - (system ? 1 : 0) - (lastHuman ? 1 : 0),
        },
        'LLM invoke',
      );
    }
  }

  handleLLMEnd(output: { generations: Array<Array<{ text: string }>> }): void {
    const text = output.generations?.[0]?.[0]?.text;
    log.debug(
      {
        responseLength: text?.length ?? 0,
        response: text ?? null,
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
