import { type AIMessage, type BaseMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { Runnable } from '@langchain/core/runnables';

import { createLogger } from '@shared/logger';

const log = createLogger('invoke-with-retry');

type InvokableModel = Runnable<BaseMessage[], AIMessage>;

function isEmptyAIResponse(response: AIMessage): boolean {
  const emptyContent =
    (typeof response.content === 'string' && response.content.trim().length === 0) ||
    (Array.isArray(response.content) && response.content.length === 0);
  const noToolCalls = !Array.isArray(response.tool_calls) || response.tool_calls.length === 0;
  return emptyContent && noToolCalls;
}

function endsWithToolMessage(messages: BaseMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last instanceof ToolMessage;
}

/**
 * Appends a system-level nudge before the last ToolMessage so the model
 * understands it must produce a text reply — not call another tool, not stay silent.
 * Inserted as SystemMessage (not HumanMessage) to avoid the model echoing it.
 */
function withPostToolNudge(messages: BaseMessage[]): BaseMessage[] {
  const nudge = new SystemMessage(
    'IMPORTANT: All tool calls are complete. You MUST now write a natural text response to the user. Do NOT call any more tools.',
  );
  let lastToolIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof ToolMessage) {
      lastToolIdx = i;
      break;
    }
  }
  if (lastToolIdx < 0) {
    return [...messages, nudge];
  }
  return [...messages.slice(0, lastToolIdx), nudge, ...messages.slice(lastToolIdx)];
}

/**
 * Invokes the model and retries once if the LLM returns an empty response with no tool calls.
 *
 * When the conversation ends with a ToolMessage (post-tool turn), inserts an explicit
 * SystemMessage nudge — some models (e.g. Gemini via OpenRouter) silently skip their reply
 * after a successful tool call when they already wrote a pre-call message.
 */
export async function invokeWithRetry(
  model: InvokableModel,
  messages: BaseMessage[],
  userId: string,
): Promise<AIMessage> {
  const postTool = endsWithToolMessage(messages);
  const firstMessages = postTool ? withPostToolNudge(messages) : messages;

  const response = await model.invoke(firstMessages, { configurable: { userId } });

  if (isEmptyAIResponse(response)) {
    log.warn({ userId }, 'LLM returned empty response — retrying once');
    // On retry always include the nudge regardless of message structure
    const retryMessages = postTool ? firstMessages : withPostToolNudge(messages);
    return model.invoke(retryMessages, { configurable: { userId } });
  }

  return response;
}
