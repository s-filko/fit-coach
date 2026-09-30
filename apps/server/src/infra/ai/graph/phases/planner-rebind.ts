import type { ConversationGraphDeps } from '@infra/ai/graph/conversation.graph';

/**
 * LOAD_PLAN_PLANNER_REBIND (load-plan plan A5, Task 5b) takes effect only together with LOAD_PLAN_SUGGESTION: the
 * rebound prompts (training v11 / session_planning v5) tell the model to start from the LOAD PLAN suggestion and the
 * planner stops writing weights, so without the suggestion there would be no load source at all. One predicate for
 * every spec that reads the flag, so the combination can never be half applied.
 */
export function plannerRebindOn(
  deps: Pick<ConversationGraphDeps, 'loadPlanPlannerRebind' | 'loadPlanSuggestion'>,
): boolean {
  return deps.loadPlanPlannerRebind === true && deps.loadPlanSuggestion === true;
}
