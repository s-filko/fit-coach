// Shared fact-constraint guard for save_workout_plan and start_training_session
// (plan P6 Task 5, decision D-G — hoisted in the P6 close-out, review finding R2).
//
// Wraps the pure domain check in `@domain/user/services/fact-conflicts` with the
// I/O both tools duplicated: read the constraints, return the `userError`
// outcome on conflict — or null so the caller proceeds.

import { type ToolOutcome, userError } from '@domain/conversation/tool-outcome';
import type { ExerciseWithMuscles } from '@domain/training/types';
import type { IUserFactsService } from '@domain/user/ports';
import { checkFactConflicts, factConflictMessage } from '@domain/user/services/fact-conflicts';

/** A `userError` outcome ready for the tool to return, or nothing to reject with. */
export type FactConstraintRejection = Extract<ToolOutcome, { ok: false; kind: 'user_error' }>;

/**
 * Fetches the user's physical constraints and checks them against exercises
 * (as resolved by `exerciseRepository.findByIdsWithMuscles`).
 *
 * Returns the `userError` outcome the tool returns verbatim when an exercise's
 * PRIMARY muscle group hits a `physical_constraint` fact, or null when the
 * call may proceed. Nothing is persisted on rejection — the caller returns
 * before any write.
 */
export async function rejectOnFactConflict(
  factsService: Pick<IUserFactsService, 'getConstraints'>,
  userId: string,
  exercises: ExerciseWithMuscles[],
): Promise<FactConstraintRejection | null> {
  const facts = await factsService.getConstraints(userId);
  const conflict = checkFactConflicts({ facts, exercises });
  return conflict === null ? null : (userError(factConflictMessage(conflict)) as FactConstraintRejection);
}
