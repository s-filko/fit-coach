/**
 * load-plan plan Task 2 (D4, D8, Task 5a): the one decision call path for a `LoadPlanEntry` — resolve the scheme in
 * force (the user's `progression_scheme` fact over the D8 default), then run the pure decision order. The LOAD PLAN
 * block, the `get_load_plan` tool, the report and the recommendation log all come here; none of them composes it
 * again, and this module writes no prompt text.
 */
import { decide, type Decision, type ProgressionChoice, progressionFromChoice } from '@domain/training/load-plan';

import type { LoadPlanEntry } from './load-facts.loader';

export interface LoadDecisionOpts {
  /** The D8 default scheme; the entry's chosen scheme overrides it. */
  progression: ProgressionChoice;
  /** Real workouts since the gap (Task 4's counter); absent = first rung. */
  ladderWorkoutsSince?: number;
}

/** Null for a non-strength exercise (schemes apply to strength). */
export function decideLoadPlanEntry(entry: LoadPlanEntry, opts: LoadDecisionOpts): Decision | null {
  if (entry.exercise.exerciseType !== 'strength') {
    return null;
  }
  const progression = progressionFromChoice(opts.progression, entry.chosenScheme);
  // Task 4 (LOAD_PLAN_BREAKS): the loader attached the ladder and the break reason to the entry.
  const branch = entry.returnBranch;
  return decide(entry.facts, {
    scheme: progression.scheme,
    goal: progression.goal,
    ladderWorkoutsSince: opts.ladderWorkoutsSince,
    ...(branch ? { ladder: branch.ladder, breakReason: branch.breakReason } : {}),
  });
}
