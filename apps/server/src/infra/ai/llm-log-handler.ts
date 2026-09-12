/**
 * The LLM boundary callback: debug logging of every model invocation (BUG-003
 * replay payload) plus the run-metrics bridge for conversation_runs (P0,
 * ADR-0013 §8). Lived inside model.factory.ts until close-out review R1 split
 * it out — model construction and callback handling are separate reasons to
 * change.
 */

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { BaseMessage } from '@langchain/core/messages';

import { loadConfig } from '@config/index';

import { bindCallToRun, finishLlmCall, resolveCallRun, startLlmCall } from '@infra/ai/run-metrics';

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

export class LLMLogHandler extends BaseCallbackHandler {
  name = 'LLMLogHandler';

  handleChatModelStart(
    _llm: Serialized,
    messages: BaseMessage[][],
    llmRunId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ): void {
    const flat = messages[0] ?? [];
    const system = flat.find(m => m._getType() === 'system');
    const humanMsgs = flat.filter(m => m._getType() === 'human');
    const lastHuman = humanMsgs[humanMsgs.length - 1];
    const options = extraParams?.['options'] as Record<string, unknown> | undefined;
    // LangChain strips `configurable` from the options a callback sees
    // (runnables/base.js `_separateRunnableConfigFromCallOptions` deletes it), so
    // runId/userId travel via config metadata — inherited by every nested model call.
    const userId = metadata?.['userId'] as string | undefined;
    const runId = metadata?.['runId'] as string | undefined;
    const invocationModel =
      ((extraParams?.['invocation_params'] as Record<string, unknown> | undefined)?.['model'] as string | undefined) ??
      config.LLM_MODEL;
    if (runId) {
      startLlmCall(runId, invocationModel);
      bindCallToRun(llmRunId, runId);
    }

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

  handleLLMEnd(
    output: {
      generations: Array<Array<{ text: string }>>;
      llmOutput?: { tokenUsage?: { promptTokens?: number; completionTokens?: number } };
    },
    llmRunId: string,
  ): void {
    const text = output.generations?.[0]?.[0]?.text;
    const usage = output.llmOutput?.tokenUsage;
    const runId = resolveCallRun(llmRunId);
    if (runId) {
      finishLlmCall(runId, usage?.promptTokens ?? 0, usage?.completionTokens ?? 0);
    }
    log.debug(
      {
        responseLength: text?.length ?? 0,
        response: text ?? null,
      },
      'LLM response',
    );
  }
}
