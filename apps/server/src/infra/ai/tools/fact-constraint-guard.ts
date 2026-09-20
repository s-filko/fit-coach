// Shared fact-constraint guard for save_workout_plan and start_training_session
// (plan P6 Task 5, decision D-G — hoisted in the P6 close-out, review finding R2;
// narrowed to permanent constraints by course-check plan Task 2, AC-FL-6).
//
// Wraps the pure domain check in `@domain/user/services/fact-conflicts` with the
// I/O both tools duplicated: read the constraints, then either return the
// `userError` outcome (a PERMANENT constraint is hit) or an advisory the tool
// appends to its success summary (every other conflict).

import { type ToolOutcome, userError } from '@domain/conversation/tool-outcome';
import type { ExerciseWithMuscles } from '@domain/training/types';
import type { IUserFactsService } from '@domain/user/ports';
import {
  blockingConflicts,
  factConflictAdvisory,
  factConflictMessage,
  findFactConflicts,
} from '@domain/user/services/fact-conflicts';

/** A `userError` outcome ready for the tool to return, or nothing to reject with. */
export type FactConstraintRejection = Extract<ToolOutcome, { ok: false; kind: 'user_error' }>;

/** What the guard decided: reject the call, or proceed (optionally with an advisory for the result). */
export interface FactConstraintVerdict {
  /** Non-null ⇒ the tool returns it verbatim and persists nothing. */
  rejection: FactConstraintRejection | null;
  /** Non-null ⇒ the call proceeds and the tool appends this text to its success summary. */
  advisory: string | null;
}

/**
 * Fetches the user's physical constraints and checks them against exercises
 * (as resolved by `exerciseRepository.findByIdsWithMuscles`).
 *
 * `now` is the run clock (ctx.now) — AC-FL-1: archived and expired constraints
 * never appear here at all.
 *
 * A `permanent` constraint hit by an exercise's PRIMARY muscle group rejects
 * the call (all such conflicts listed; nothing is persisted — the caller
 * returns before any write). Any other constraint's conflicts never reject:
 * they come back as an advisory naming the fact and EVERY conflicting exercise.
 */
export async function guardFactConstraints(
  factsService: Pick<IUserFactsService, 'getConstraints'>,
  userId: string,
  exercises: ExerciseWithMuscles[],
  now: Date,
): Promise<FactConstraintVerdict> {
  const facts = await factsService.getConstraints(userId, now);
  const conflicts = findFactConflicts({ facts, exercises });
  const blocking = blockingConflicts(conflicts);
  if (blocking.length > 0) {
    return { rejection: userError(factConflictMessage(blocking)) as FactConstraintRejection, advisory: null };
  }
  return { rejection: null, advisory: conflicts.length > 0 ? factConflictAdvisory(conflicts) : null };
}
