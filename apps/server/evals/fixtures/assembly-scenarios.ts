/**
 * Fixtures for the message-assembly snapshot suite (refactor-p2-context-assembler
 * Task 1). Hand-written content only (BR-EVAL-003).
 */
import { AIMessage, type BaseMessage, ToolMessage } from '@langchain/core/messages';

import { LLM_ERROR_PREFIX } from '@infra/ai/graph/tools/training.tools';

/** The three scenarios each phase runs through the recording harness. */
export type AssemblyScenario = 'plain' | 'with-summary' | 'post-tool';

export const ASSEMBLY_SCENARIOS: readonly AssemblyScenario[] = ['plain', 'with-summary', 'post-tool'];

/**
 * Mid-tool-loop in-flight messages a subgraph receives in `state.messages`
 * while the model has not yet produced its text reply.
 *
 * Composition: one AIMessage carrying two tool calls (save_timezone + log_set),
 * one successful ToolMessage and one errored ToolMessage whose content starts
 * with LLM_ERROR_PREFIX — so training's tool-results block (`renderToolResults`) exercises
 * its `ok: false` branch. Exactly one error: training's LLM_ERROR_RETRY_BUDGET
 * is 1, so the error count does NOT exceed the budget and the model is still
 * invoked (a second error would short-circuit the agent before any LLM call).
 */
export const IN_FLIGHT_POST_TOOL: BaseMessage[] = [
  new AIMessage({
    content: 'Сейчас запишу подход и сохраню часовой пояс.',
    tool_calls: [
      { id: 'call-1', name: 'save_timezone', args: { timezone: 'Europe/Berlin' } },
      { id: 'call-2', name: 'log_set', args: { exerciseName: 'Жим лёжа', weight: 60, reps: 8 } },
    ],
  }),
  new ToolMessage({ tool_call_id: 'call-1', content: 'Timezone saved: Europe/Berlin' }),
  new ToolMessage({
    tool_call_id: 'call-2',
    content: `${LLM_ERROR_PREFIX} Invalid set data: exercise id not found in session`,
    status: 'error',
  }),
];

export interface SerializedMessage {
  type: string;
  content: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  status?: string;
}

/**
 * Reduces a message array to the fields that make any reorder, merge or
 * content drift visible: type, content, tool_calls (AI messages with calls),
 * tool_call_id and status (tool messages).
 */
export function serializeForSnapshot(messages: BaseMessage[]): SerializedMessage[] {
  return messages.map(m => {
    const entry: SerializedMessage = { type: m._getType(), content: m.content };
    if (m instanceof AIMessage && m.tool_calls && m.tool_calls.length > 0) {
      entry.tool_calls = m.tool_calls;
    }
    if (m instanceof ToolMessage) {
      entry.tool_call_id = m.tool_call_id;
      if (m.status !== undefined) {
        entry.status = m.status;
      }
    }
    return entry;
  });
}
