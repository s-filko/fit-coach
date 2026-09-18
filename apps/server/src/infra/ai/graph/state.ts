/**
 * Durable state vs run context (ADR-0013 §3.2): the checkpointed
 * ConversationState holds only what must survive between runs; everything
 * about *this* run travels as caller-provided, immutable run context and is
 * never checkpointed.
 */
import type { BaseMessage } from '@langchain/core/messages';
import { Annotation, type LangGraphRunnableConfig, messagesStateReducer } from '@langchain/langgraph';

import type { CompactReason, StoredEpisodeSummary } from '@domain/conversation/episode';
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
  // Episode memory (ADR-0013 §3.2/§3.3, P4). Writers per channel:
  //  - episodeSummaries: `compact` appends one StoredEpisodeSummary, keeps the
  //    last 3, oldest first (BR-LLM-001..003); read by the prompt block.
  //  - episodeId: `prepare` sets it to ctx.runId when empty or right after a
  //    compaction (D-O — the id of the run that started the episode).
  //  - episodeStartedAt: `compact` (the new episode begins at compaction time).
  //  - lastUserMessageAt: `commit` stamps ctx.now after every run (BR-LLM-001's
  //    clock input, and the greeting directive's input — D-M).
  //  - compactReason: the compaction-flag transition handler sets
  //    'phase_boundary' (D-A); `compact` resets it to null after consuming.
  episodeSummaries: Annotation<StoredEpisodeSummary[]>({ reducer: (_, v) => v, default: () => [] }),
  episodeId: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  episodeStartedAt: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
  lastUserMessageAt: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
  compactReason: Annotation<CompactReason | null>({ reducer: (_, v) => v, default: () => null }),
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
