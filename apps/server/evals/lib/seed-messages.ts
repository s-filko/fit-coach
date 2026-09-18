import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import type { StateMessage } from '../schema/case.schema';

/**
 * A case's seed messages → the channel's BaseMessage shape (P4 Task 7): the
 * eval harness seeds the episode the way production got it — through the
 * checkpointed `messages` channel, not a stub service. `tool_call` seeds
 * merge into the preceding AIMessage's `tool_calls` (a bare tool-call message
 * is not a legal channel shape); `tool_result` becomes a ToolMessage.
 */
export function toBaseMessages(seeds: StateMessage[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const seed of seeds) {
    if (seed.role === 'human') {
      out.push(new HumanMessage(seed.text));
    } else if (seed.role === 'ai') {
      out.push(new AIMessage({ content: seed.text, tool_calls: [] }));
    } else if (seed.role === 'tool_call') {
      const call = { id: seed.id, name: seed.name, args: seed.args, type: 'tool_call' as const };
      const last = out[out.length - 1];
      if (last?._getType() === 'ai') {
        out[out.length - 1] = new AIMessage({
          content: (last as AIMessage).content,
          tool_calls: [...((last as AIMessage).tool_calls ?? []), call],
        });
      } else {
        out.push(new AIMessage({ content: '', tool_calls: [call] }));
      }
    } else if (seed.role === 'tool_result') {
      out.push(
        new ToolMessage({
          // bindSeedMessages (parseCases) guarantees the id is bound by here.
          tool_call_id: seed.toolCallId!,
          content: seed.text,
          ...(seed.status === 'error' ? { status: 'error' as const } : {}),
        }),
      );
    }
  }
  return out;
}
