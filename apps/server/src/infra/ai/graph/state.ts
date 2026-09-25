/**
 * Durable state vs run context (ADR-0013 §3.2): the checkpointed
 * ConversationState holds only what must survive between runs; everything
 * about *this* run travels as caller-provided, immutable run context and is
 * never checkpointed.
 */
import type { BaseMessage } from '@langchain/core/messages';
import { Annotation, type LangGraphRunnableConfig, messagesStateReducer } from '@langchain/langgraph';

import type { CompactReason, StoredEpisodeSummary } from '@domain/conversation/episode';
import type { ConversationPhase } from '@domain/conversation/phases';
import type { TransitionRequest } from '@domain/conversation/transitions';
import type { User } from '@domain/user/services/user.service';

import type { CourseCheckFailure, StoredCourseDirective } from '@infra/ai/course-check/directive';
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
  // The course-check directive (course-check plan Task 1, AC-FL-5): written by
  // the course-check step inside `prepare` when one of its events fires,
  // rendered by the agent node as one prompt block while its fingerprint
  // holds, cleared to null when the layer is switched off. Plain JSON, so the
  // checkpointer round-trips it without adapters.
  courseDirective: Annotation<StoredCourseDirective | null>({ reducer: (_, v) => v, default: () => null }),
  // The last failed course-check attempt (fingerprint + when): the cooldown
  // input that keeps a provider outage from costing a failed call per turn.
  // Cleared by the next success or when the layer is switched off.
  courseCheckFailure: Annotation<CourseCheckFailure | null>({ reducer: (_, v) => v, default: () => null }),
  // The expiry questions ASKED THIS RUN (course-check expiry): set by the
  // course-check step when the run's directive carries them, rendered by the
  // agent node next to the stored directive's questions, cleared by `commit` at
  // the end of the run — never part of the persisted directive, because the
  // fact they are about is archived in the same run and the question belongs to it.
  courseExpiryQuestions: Annotation<string[]>({ reducer: (_, v) => v, default: () => [] }),
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
  /**
   * The manual-compaction pass (`/compact`): `prepare` runs the compact step
   * with reason 'manual' and ends the run — no agent, no commit. No message
   * was appended, so there is no "current run": the whole channel is
   * foldable. Absent on every ordinary run.
   */
  compactOnly: Annotation<boolean | undefined>(),
  /**
   * transition-handoff plan Task 2 (D-3): hop facts for THIS run only, never
   * checkpointed — mutated in place on the same ctx object across both commit
   * calls of a hop, exactly like `metrics`. `phasePath` gets one phase pushed
   * per commit call (the phase it committed FROM); its length is the
   * "already hopped" guard (max 1 hop, no revisit) and, once > 1, is D-2's
   * `transition.path`. `hopping` is the commit → route conditional edge's
   * signal, set on every commit call. `hopBoundaryIndex` is where in
   * `current` the second phase's messages start — the looping commit's
   * transcript-projection cutoff and `runAiText`'s delivery cutoff; unset on
   * a run with no hop. `hopTransition` is the request that triggered the hop
   * — the final commit's own `pendingTransition` is already null by then, so
   * its run row reads the toPhase/reason from here. All absent/undefined
   * until commit first runs.
   */
  phasePath: Annotation<ConversationPhase[] | undefined>(),
  hopping: Annotation<boolean | undefined>(),
  hopBoundaryIndex: Annotation<number | undefined>(),
  hopTransition: Annotation<TransitionRequest | undefined>(),
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
