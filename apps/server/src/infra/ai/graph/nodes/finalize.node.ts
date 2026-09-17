/**
 * The finalize node (ADR-0013 §4.1): the place that validates the final
 * AIMessage has text — the agent node's catalog fallback already guarantees
 * it, so the node returns no update. `refactor-p3-run-context-commit`:
 * responseMessage/user left the state; the reply is read by `commit`.
 */
import type { BaseMessage } from '@langchain/core/messages';

export interface FinalizeNodeState {
  messages: BaseMessage[];
}

export function buildFinalizeNode() {
  return async (state: FinalizeNodeState): Promise<Record<string, never>> => {
    const last = state.messages[state.messages.length - 1];
    // Duck-typed (_getType, not instanceof): jest.resetModules in graph tests
    // re-evaluates @langchain/core and would split the AIMessage class.
    if (
      last === undefined ||
      last._getType() !== 'ai' ||
      (typeof last.content === 'string' && last.content.trim() === '')
    ) {
      throw new Error('finalize: run ended without a final AIMessage with text');
    }
    return {};
  };
}
