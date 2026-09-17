/**
 * Durable state vs run context (ADR-0013 §3.2): the checkpointed
 * ConversationState holds only what must survive between runs; everything
 * about *this* run travels as caller-provided, immutable run context and is
 * never checkpointed.
 */
import type { BaseMessage } from '@langchain/core/messages';
import { Annotation, type LangGraphRunnableConfig, messagesStateReducer } from '@langchain/langgraph';

import type { TransitionRequest } from '@domain/conversation/transitions';
import type { User } from '@domain/user/services/user.service';

import type { RunMetricsCollector } from '@infra/ai/run-metrics';

export const ConversationState = Annotation.Root({
  phase: Annotation<import('@domain/conversation/phases').ConversationPhase>({
    reducer: (_, v) => v,
    default: () => 'registration',
  }),
  activeSessionId: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  pendingTransition: Annotation<TransitionRequest | null>({ reducer: (_, v) => v, default: () => null }),
  // P4 adds: episodeSummaries, episodeStartedAt, lastUserMessageAt, draft
});

export type ConversationStateType = typeof ConversationState.State;

export const RunContext = Annotation.Root({
  runId: Annotation<string>(),
  userId: Annotation<string>(),
  user: Annotation<User>(),
  now: Annotation<Date>(),
  client: Annotation<'telegram' | 'webapp'>(),
  trigger: Annotation<'user_message' | 'system'>(),
  metrics: Annotation<RunMetricsCollector>(),
});

export type RunContextType = typeof RunContext.State;

/**
 * The one accessor for run context. Task 1's spike (2026-09-17, LangGraph
 * 1.1.5) pinned that `config.context` reaches parent nodes, subgraph nodes
 * and tools alike — no `configurable.ctx` fallback is needed.
 */
export function ctxOf(config: LangGraphRunnableConfig): RunContextType {
  const ctx = config.context as RunContextType | undefined;
  if (!ctx?.runId) {
    throw new Error('Run context is missing — invoke the graph through the conversation-run adapter');
  }
  return ctx;
}
