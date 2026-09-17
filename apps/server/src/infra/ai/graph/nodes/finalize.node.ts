/**
 * The shared finalize node (ADR-0013 §4.1, refactor-p3-phase-spec Task 2):
 * today's extractNode minus the map consumption (already gone) — the final
 * text out, a fresh user in. `refactor-p3-run-context-commit` deletes both
 * fields from the subgraph state.
 */
import type { BaseMessage } from '@langchain/core/messages';

import type { IUserService } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import { textOf } from '@infra/ai/llm.gateway';

export interface FinalizeNodeState {
  messages: BaseMessage[];
  userId: string;
  user?: User | null;
}

export interface FinalizeNodeUpdate {
  responseMessage: string;
  user: User | null;
}

export function buildFinalizeNode(deps: { userService: IUserService }) {
  const { userService } = deps;

  return async (state: FinalizeNodeState): Promise<FinalizeNodeUpdate> => {
    const last = state.messages[state.messages.length - 1];
    // Duck-typed (_getType, not instanceof): jest.resetModules in graph tests
    // re-evaluates @langchain/core and would split the AIMessage class.
    const responseMessage = last !== undefined && last._getType() === 'ai' ? textOf(last.content) : '';

    // Read fresh user from DB to capture any fields saved by tools during this turn
    const freshUser = state.userId ? await userService.getUser(state.userId).catch(() => null) : null;

    return { responseMessage, user: freshUser ?? state.user ?? null };
  };
}
