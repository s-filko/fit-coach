import { type ToolOutcome, userError } from '@domain/conversation/tool-outcome';
import type { ITrainingService } from '@domain/training/ports';

/**
 * BUG-008 Plan A, kept as a rejection (prompt-caching plan D4): `delete_last_sets` / `update_last_set` make no
 * sense before the current exercise has a set. They used to be hidden from the tool list until then, but the tool
 * list is the first thing in the cached request prefix, so hiding was a full cache miss each time it flipped.
 * Returns the refusal to hand back, or null when the call may proceed. It is a `user_error` (a refusal the model relays
 * or works around, rendered as a normal tool result), NOT an `llm_error`: training's `llmErrorBudget` is 1, and a
 * premature delete/update must not spend it and end the run with `tool_error_budget_exhausted`.
 */
export async function rejectWithoutLoggedSet(
  trainingService: Pick<ITrainingService, 'getSessionDetails'>,
  sessionId: string,
  toolName: 'delete_last_sets' | 'update_last_set',
): Promise<ToolOutcome | null> {
  const session = await trainingService.getSessionDetails(sessionId);
  const current = session?.exercises?.find(ex => ex.status === 'in_progress');
  if ((current?.sets?.length ?? 0) > 0) {
    return null;
  }
  return userError(
    `${toolName} is not available yet: no set has been logged for the current exercise, so there is nothing to change.`,
    'If the user reports a set, log it with log_set; otherwise ask what they mean.',
  );
}
