import { Annotation } from '@langchain/langgraph';

import { ConversationPhase } from '@domain/conversation/ports';
import { ChatMsg } from '@domain/user/ports';

export const ConversationState = Annotation.Root({
  userId: Annotation<string>,
  phase: Annotation<ConversationPhase>,
  messages: Annotation<ChatMsg[]>({
    reducer: (cur, upd) => [...cur, ...upd],
    default: () => [],
  }),
  userMessage: Annotation<string>,
  responseMessage: Annotation<string>({
    reducer: (_, upd) => upd,
    default: () => '',
  }),
  requestedTransition: Annotation<{
    toPhase: ConversationPhase;
    reason?: string;
    sessionId?: string;
  } | null>({
    reducer: (_, upd) => upd,
    default: () => null,
  }),
});

export type ConversationStateType = typeof ConversationState.State;
