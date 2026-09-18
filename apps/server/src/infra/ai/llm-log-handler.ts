/**
 * The LLM boundary callback: debug logging of every model invocation (BUG-003
 * replay payload). Run metrics live in the per-run collector's handler
 * (run context) since refactor-p3-run-context-commit — this handler only logs.
 */

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { BaseMessage } from '@langchain/core/messages';

import { loadConfig } from '@config/index';

import { createLogger } from '@shared/logger';

const log = createLogger('llm');

// Config is read on first use, not at import: this module sits on the import
// path of the eval runner (run-case → conversation-run.adapter → episode →
// llm.gateway → model.factory), and L0 runs in CI without a .env. An
// import-time loadConfig() there fails the whole L0 step (dev deploys were red
// from f8387ee6 to bbed9f50 because of it).
let cached: ReturnType<typeof loadConfig> | null = null;
function config(): ReturnType<typeof loadConfig> {
  cached ??= loadConfig();
  return cached;
}

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
    const invocationParams = extraParams?.['invocation_params'] as Record<string, unknown> | undefined;
    // LangChain strips `configurable` from the options a callback sees
    // (runnables/base.js `_separateRunnableConfigFromCallOptions` deletes it), so
    // userId travels via config metadata — inherited by every nested model call.
    // (runId left this handler with the P3 run-metrics move; the per-run
    // collector's handler owns run identity now.)
    const userId = metadata?.['userId'] as string | undefined;
    const cfg = config();
    const invocationModel = (invocationParams?.['model'] as string | undefined) ?? cfg.LLM_MODEL;
    const isDebug = cfg.LOG_LEVEL === 'debug' || cfg.LOG_LEVEL === 'trace';

    if (isDebug) {
      const tools = options?.['tools'] as unknown[] | undefined;

      const openaiMessages = flat.map(messageToOpenAI);
      const replayPayload: Record<string, unknown> = {
        model: invocationModel,
        messages: openaiMessages,
        temperature: invocationParams?.['temperature'] ?? cfg.LLM_TEMPERATURE,
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- positional callback signature
    _llmRunId: string,
  ): void {
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
