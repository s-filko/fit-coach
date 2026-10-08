/**
 * Phase transitions (ADR-0013 §4.3): the matrix and its guards are domain
 * rules (BR-CONV-015..018); the graph's `commit` node calls
 * `evaluateTransition` — the domain never imports LangGraph.
 */
import type { ConversationPhase } from './phases';

/** A phase change requested by a tool or a short-circuit, evaluated by commit. */
export interface TransitionRequest {
  toPhase: ConversationPhase;
  reason?: string;
}

/** Today's guard matrix, verbatim (BR-CONV-015). */
export const TRANSITION_MATRIX: Readonly<Record<ConversationPhase, readonly ConversationPhase[]>> = {
  registration: ['chat', 'plan_creation'],
  chat: ['plan_creation', 'session_planning'],
  plan_creation: ['chat', 'session_planning'],
  session_planning: ['training', 'chat'],
  training: ['chat'],
};

export interface TransitionInput {
  phase: ConversationPhase;
  activeSessionId: string | null;
  request: TransitionRequest;
}

export type TransitionVerdict =
  | { ok: true; toPhase: ConversationPhase }
  | { ok: false; reason: 'not_allowed' | 'no_active_session' };

/** BR-CONV-015 (matrix), BR-CONV-016 (training needs an active session),
 * BR-CONV-017 (training → session_planning absent). */
export function evaluateTransition(input: TransitionInput): TransitionVerdict {
  const { phase, activeSessionId, request } = input;
  const allowedTargets = TRANSITION_MATRIX[phase] ?? [];
  if (!allowedTargets.includes(request.toPhase)) {
    return { ok: false, reason: 'not_allowed' };
  }
  if (request.toPhase === 'training' && !activeSessionId) {
    return { ok: false, reason: 'no_active_session' };
  }
  return { ok: true, toPhase: request.toPhase };
}
