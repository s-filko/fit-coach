/**
 * route (ADR-0013 §4.1): pure routing to the current phase — the node the
 * specs' names are the ends of. Adding a phase needs no edit here (INV-LLM-005).
 */
import { Command } from '@langchain/langgraph';

import type { ConversationStateType } from '@infra/ai/graph/state';

export function buildRouteNode(phaseNames: readonly string[]) {
  return async function routeNode(state: ConversationStateType): Promise<Command<Partial<ConversationStateType>>> {
    void phaseNames;
    return new Command({ goto: state.phase });
  };
}
