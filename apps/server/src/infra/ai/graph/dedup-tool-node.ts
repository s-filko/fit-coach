import { type AIMessage, type BaseMessage, ToolMessage } from '@langchain/core/messages';
import type { ToolCall } from '@langchain/core/messages/tool';
import type { StructuredToolInterface } from '@langchain/core/tools';

import { createLogger } from '@shared/logger';

const log = createLogger('dedup-tool-node');

type InvokableTool = {
  invoke: (args: Record<string, unknown>, config: { configurable: Record<string, unknown> }) => Promise<unknown>;
};

/**
 * Builds a deduplicating tool node for plan-creation and session-planning subgraphs.
 *
 * When the LLM calls `search_exercises` multiple times in one response with identical
 * parameters, only the first unique call is executed (embed + DB query). Duplicate calls
 * receive the cached result immediately — no extra embed or vector search.
 *
 * Non-`search_exercises` tools are executed normally, in call order.
 *
 * This mirrors the pattern in training.subgraph.ts (sequentialToolNode) which already
 * deduplicates `log_set` calls.
 */
export function buildDedupToolNode(tools: StructuredToolInterface[]) {
  const toolMap = Object.fromEntries(tools.map(t => [t.name, t]));

  async function invokeTool(call: ToolCall, userId: string): Promise<ToolMessage> {
    const targetTool = toolMap[call.name];
    if (!targetTool) {
      return new ToolMessage({
        tool_call_id: call.id ?? '',
        content: `Unknown tool: ${call.name}`,
        status: 'error',
      });
    }
    try {
      const result = await (targetTool as InvokableTool).invoke(call.args as Record<string, unknown>, {
        configurable: { userId },
      });
      return new ToolMessage({ tool_call_id: call.id ?? '', content: String(result) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ userId, tool: call.name, err: message }, 'Tool invocation failed');
      return new ToolMessage({
        tool_call_id: call.id ?? '',
        content: `Error: ${message}`,
        status: 'error',
      });
    }
  }

  return async (state: { messages: BaseMessage[]; userId: string }) => {
    const { userId } = state;
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage | undefined;
    if (!lastMessage || !('tool_calls' in lastMessage)) {
      return { messages: [] };
    }
    const toolCalls = lastMessage.tool_calls ?? [];

    // Per-turn dedup cache: searchKey → result string (lives only for this turn)
    const searchCache = new Map<string, string>();
    const toolMessages: ToolMessage[] = [];

    for (const call of toolCalls) {
      if (call.name === 'search_exercises') {
        const key = buildSearchKey(call.args as Record<string, unknown>);
        const cached = searchCache.get(key);

        if (cached !== undefined) {
          log.debug({ userId, query: String(call.args['query'] ?? '') }, 'search_exercises dedup hit — reusing result');
          toolMessages.push(new ToolMessage({ tool_call_id: call.id ?? '', content: cached }));
        } else {
          // eslint-disable-next-line no-await-in-loop
          const msg = await invokeTool(call, userId);
          searchCache.set(key, msg.content as string);
          toolMessages.push(msg);
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        toolMessages.push(await invokeTool(call, userId));
      }
    }

    const totalSearchCalls = toolCalls.filter(c => c.name === 'search_exercises').length;
    const dedupCount = totalSearchCalls - searchCache.size;
    if (dedupCount > 0) {
      log.info(
        { userId, dedupCount, uniqueSearches: searchCache.size, totalSearchCalls },
        'search_exercises dedup saved calls',
      );
    }

    return { messages: toolMessages };
  };
}

function buildSearchKey(args: Record<string, unknown>): string {
  return JSON.stringify({
    q: String(args['query'] ?? '')
      .toLowerCase()
      .trim(),
    c: args['category'] ?? null,
    e: args['equipment'] ?? null,
    m: args['muscleGroup'] ?? null,
    l: args['limit'] ?? null,
  });
}
