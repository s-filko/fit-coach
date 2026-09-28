/**
 * The ACCEPTED hand-off predicate (transition-handoff plan close-out review,
 * Blocking 1) — the ONE place `tool-executor.ts` (silencing the carrier,
 * routing to `'handoff'`) and `commit.node.ts` (looping back to `route`)
 * decide whether a committed transition is a same-run hand-off, so the two
 * can never disagree again. Before this file existed, both computed the
 * verdict independently (R1/R2 advisory) and only `commit` enforced the
 * max-1-hop guard (`ctx.phasePath`) — a chat → session_planning hop whose
 * planning reply then called `start_training_session` (also a hand-off
 * target) had its text silently emptied by the executor while `commit`
 * correctly refused the second hop, delivering '' to the user.
 *
 * A target `evaluateTransition` would block (e.g. no active session), or a
 * run that has ALREADY hopped once, is not an accepted hand-off — the caller
 * falls through to today's path: the phase's own agent gets another turn (in
 * the executor) or the run ends normally without looping (in commit).
 * `alreadyHopped` is the caller's own read of `ctx.phasePath` — the executor
 * asks before this call's commit has pushed its phase (non-empty path means
 * a hop already happened), commit asks after pushing its own phase (path
 * longer than 1 means the SAME thing, from its own vantage point).
 */
import type { ConversationPhase } from '@domain/conversation/phases';
import { evaluateTransition, type TransitionRequest } from '@domain/conversation/transitions';

/**
 * The hand-off tool-result wording (D-5, close-out review Blocking 3): one
 * contract phrase, one source. Used by `start-training-session.tool.ts` and
 * `request-transition.tool.ts`'s chat variant when their committed target is
 * a configured hand-off target — the phase subgraph ends right after the
 * tool runs, so the model never gets a turn to act on "write a message to
 * the user", and this neutral text replaces it.
 */
export const HANDOFF_REGISTERED_TEXT = 'Transition registered; the next phase answers the user.';

export function isAcceptedHandoff(
  handoffTargets: ReadonlySet<ConversationPhase>,
  phase: ConversationPhase | undefined,
  activeSessionId: string | null | undefined,
  pendingTransition: TransitionRequest | null | undefined,
  alreadyHopped: boolean,
): boolean {
  if (alreadyHopped || !pendingTransition || !handoffTargets.has(pendingTransition.toPhase) || phase === undefined) {
    return false;
  }
  const verdict = evaluateTransition({
    phase,
    activeSessionId: activeSessionId ?? null,
    request: pendingTransition,
  });
  return verdict.ok;
}
