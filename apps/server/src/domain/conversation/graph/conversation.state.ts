import { Annotation } from '@langchain/langgraph';

import { ConversationPhase } from '@domain/conversation/ports';
import { User } from '@domain/user/services/user.service';

export interface TransitionRequest {
  toPhase: ConversationPhase;
  reason?: string;
}

export const ConversationState = Annotation.Root({
  userId: Annotation<string>({
    reducer: (_, v) => v,
    default: () => '',
  }),
  phase: Annotation<ConversationPhase>({
    reducer: (_, v) => v,
    default: () => 'registration' as ConversationPhase,
  }),
  userMessage: Annotation<string>({
    reducer: (_, v) => v,
    default: () => '',
  }),
  responseMessage: Annotation<string>({
    reducer: (_, v) => v,
    default: () => '',
  }),
  user: Annotation<User | null>({
    reducer: (_, v) => v,
    default: () => null,
  }),
  activeSessionId: Annotation<string | null>({
    reducer: (_, v) => v,
    default: () => null,
  }),
  requestedTransition: Annotation<TransitionRequest | null>({
    reducer: (_, v) => v,
    default: () => null,
  }),
});

export type ConversationStateType = typeof ConversationState.State;
