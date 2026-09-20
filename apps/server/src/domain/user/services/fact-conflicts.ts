// Validation against physical_constraint facts (plan P6 Task 5, decision D-G;
// narrowed by the course-check plan Task 2, AC-FL-6).
//
// Pure domain logic — no I/O. The tools resolve exercise IDs to muscles via
// exerciseRepository.findByIdsWithMuscles and pass the result here.
//
// Why only `permanent` blocks (owner, 2026-09-20): a muscle label expresses
// neither movement nor load, so the primary-muscle intersection is a rough
// signal — against the real catalog a lower_back constraint blocks Conventional
// Deadlift and Hyperextension (the rehab exercise) while allowing Romanian
// Deadlift and Barbell Row. A hard refusal on a soft, model-assigned label is
// honest for exactly one class: `permanent`. Everything else INFORMS the coach
// (an advisory it must address) and the user's word decides. The durability is
// read off the fact (wave A owns it, see fact-lifecycle.ts) — never re-derived.

import type { ExerciseWithMuscles, MuscleGroup } from '@domain/training/types';

import type { UserFact } from '../ports/user-facts.ports';

/** A conflict between one exercise and one physical_constraint fact. */
export interface FactConflict {
  exerciseId: string;
  exerciseName: string;
  fact: UserFact;
}

/**
 * EVERY conflict between the exercises and the user's facts (possibly empty),
 * in exercise order and, within an exercise, fact order.
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
 * Whether a conflict blocks or advises is `blockingConflicts`' business.
 */
export function findFactConflicts({
  facts,
  exercises,
}: {
  facts: UserFact[];
  exercises: ExerciseWithMuscles[];
}): FactConflict[] {
  const constraints = facts.filter(f => f.category === 'physical_constraint' && f.muscleGroup !== null);
  const conflicts: FactConflict[] = [];
  for (const exercise of exercises) {
    const primary = new Set(exercise.muscleGroups.filter(m => m.involvement === 'primary').map(m => m.muscleGroup));
    for (const fact of constraints) {
      if (primary.has(fact.muscleGroup as MuscleGroup)) {
        conflicts.push({ exerciseId: exercise.id, exerciseName: exercise.name, fact });
      }
    }
  }
  return conflicts;
}

/** The conflicts that reject the call: only a `permanent` fact blocks (AC-FL-6). */
export function blockingConflicts(conflicts: FactConflict[]): FactConflict[] {
  return conflicts.filter(c => c.fact.durability === 'permanent');
}

/**
 * The `userError` message both tools return when a permanent constraint is hit
 * (ADR-0013 §6: valid call, business rule says no — the model relays it to the
 * user). One conflict keeps the original wording; several are all listed.
 */
export function factConflictMessage(conflicts: FactConflict[]): string {
  const line = ({ exerciseName, fact }: FactConflict): string =>
    `"${exerciseName}" primarily trains the ${fact.muscleGroup}, but the user has a physical constraint: "${fact.fact}"`;
  if (conflicts.length === 1) {
    return `Cannot proceed: ${line(conflicts[0])}. Remove or replace that exercise and explain the substitution to the user.`;
  }
  return (
    `Cannot proceed: ${conflicts.length} exercises hit permanent physical constraints:\n` +
    conflicts.map(c => `- ${line(c)}`).join('\n') +
    '\nRemove or replace those exercises and explain the substitution to the user.'
  );
}

/**
 * The advisory appended to a SUCCESSFUL tool result for non-blocking conflicts:
 * names each fact (with its durability and phase note) and EVERY exercise it
 * touches, and tells the coach it must address them in its reply. The user's
 * word decides — the coach explains, asks or substitutes; it does not refuse.
 */
export function factConflictAdvisory(conflicts: FactConflict[]): string {
  const byFact = new Map<string, { fact: UserFact; exercises: string[] }>();
  for (const { fact, exerciseName } of conflicts) {
    const entry = byFact.get(fact.id) ?? { fact, exercises: [] };
    entry.exercises.push(exerciseName);
    byFact.set(fact.id, entry);
  }
  const lines = [...byFact.values()].map(({ fact, exercises }) => {
    const phase = fact.phaseNote ? `; ${fact.phaseNote}` : '';
    const names = exercises.map(n => `"${n}"`).join(', ');
    return `- "${fact.fact}" (${fact.durability}${phase}) vs ${names} — primarily trains the ${fact.muscleGroup}`;
  });
  return (
    'ADVISORY — saved, but these exercises primarily train a muscle group the user has a non-permanent constraint on:\n' +
    lines.join('\n') +
    '\nYou must address this in your reply: tell the user, and ask whether it is still an issue or offer a replacement. The user’s word decides.'
  );
}
