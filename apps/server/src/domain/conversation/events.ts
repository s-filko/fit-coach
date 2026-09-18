/**
 * The typed phase-transition event (owner decision 2026-09-17): `commit`
 * raises it in-process after evaluating the matrix; handlers do the side
 * effects. Consumers today: session lifecycle, the legacy phase summary;
 * P4 adds compaction.
 */
import type { CompactReason } from './episode';
import type { ConversationPhase } from './phases';

/** Raised once per committed phase transition, after the run row is recorded. */
export interface PhaseTransitionCommitted {
  type: 'phase_transition_committed';
  userId: string;
  runId: string;
  from: ConversationPhase;
  to: ConversationPhase;
  reason: string | null;
  /** As it was before commit's handlers ran. */
  activeSessionId: string | null;
  at: Date;
}

/**
 * What a handler wants changed in durable state after handling the event
 * (commit merges the partials in handler order).
 */
export type TransitionHandlerResult = Partial<{ activeSessionId: string | null; compactReason: CompactReason }>;

/**
 * Ordered, awaited (D-C): the compaction flag comes first, session activation completes before the reply.
 * One failing handler is logged at `error`; the others still run; the reply
 * is not failed (BR-CONV-007 spirit).
 */
export type TransitionHandler = (event: PhaseTransitionCommitted) => Promise<TransitionHandlerResult>;
