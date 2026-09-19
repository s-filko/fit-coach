// Hard validation against physical_constraint facts (plan P6 Task 5, decision D-G).
//
// Pure domain logic — no I/O. The tools resolve exercise IDs to muscles via
// exerciseRepository.findByIdsWithMuscles and pass the result here.

import type { ExerciseWithMuscles, MuscleGroup } from '@domain/training/types';

import type { UserFact } from '../ports/user-facts.ports';

/** A hard conflict between one exercise and one physical_constraint fact. */
export interface FactConflict {
  exerciseId: string;
  exerciseName: string;
  fact: UserFact;
}

/**
 * The first hard conflict between the exercises and the user's facts, or null.
 *
 * A conflict is the intersection of an exercise's **PRIMARY** muscle groups
 * with the `muscleGroup` of a fact whose category is `physical_constraint`:
 *
 * - an exercise where the constrained muscle is only a **secondary** muscle is
 *   NOT a conflict — constraints bind on primary involvement only;
 * - a fact of any other category (preferences are soft, per ADR-0009's
 *   category semantics) is NOT a conflict, even with a matching `muscleGroup`;
 * - a `physical_constraint` fact with a null `muscleGroup` binds nothing.
 *
 * Exercises are scanned in order; the first conflicting exercise/fact pair wins.
 */
export function checkFactConflicts({
  facts,
  exercises,
}: {
  facts: UserFact[];
  exercises: ExerciseWithMuscles[];
}): FactConflict | null {
  const constraints = facts.filter(f => f.category === 'physical_constraint' && f.muscleGroup !== null);
  if (constraints.length === 0) {
    return null;
  }

  for (const exercise of exercises) {
    const primary = new Set(exercise.muscleGroups.filter(m => m.involvement === 'primary').map(m => m.muscleGroup));
    if (primary.size === 0) {
      continue;
    }
    for (const fact of constraints) {
      if (primary.has(fact.muscleGroup as MuscleGroup)) {
        return { exerciseId: exercise.id, exerciseName: exercise.name, fact };
      }
    }
  }
  return null;
}

/**
 * The `userError` message both tools return for a conflict (ADR-0013 §6:
 * valid call, business rule says no — the model relays it to the user).
 */
export function factConflictMessage(conflict: FactConflict): string {
  const { exerciseName, fact } = conflict;
  return (
    `Cannot proceed: "${exerciseName}" primarily trains the ${fact.muscleGroup}, ` +
    `but the user has a physical constraint: "${fact.fact}". ` +
    'Remove or replace that exercise and explain the substitution to the user.'
  );
}
