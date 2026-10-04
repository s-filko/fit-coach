import type { AutoCompletedExercise } from '@domain/training/ports';
import { workingSets } from '@domain/training/sets';

/** Reads the user id the executor put into the tool config; null when absent. */
export function userIdOf(config: { configurable?: Record<string, unknown> } | undefined): string | null {
  const userId = config?.configurable?.['userId'];
  return typeof userId === 'string' && userId ? userId : null;
}

/** Reads the current session id the executor put into the tool config. */
export function sessionIdOf(config: { configurable?: Record<string, unknown> } | undefined): string | null {
  const sessionId = config?.configurable?.['activeSessionId'];
  return typeof sessionId === 'string' && sessionId ? sessionId : null;
}

/**
 * The facts of an auto-completed / completed exercise. Facts only (coach-simplification I1): the former
 * instruction tails ("summarize…", "announce the next exercise…") drove unrequested recaps and are gone. Loads are
 * not planned any more, so the Target line is sets × reps only; the logged sets keep their weights.
 */
export function formatExerciseSummary(ex: AutoCompletedExercise): string {
  const setsDetail = ex.sets
    .map(s => {
      const parts = [`Set ${s.setNumber}:`];
      if (s.reps != null) {
        parts.push(`${s.reps} reps`);
      }
      if (s.weight != null) {
        parts.push(`@ ${s.weight} ${s.weightUnit ?? 'kg'}`);
      }
      if (s.duration != null) {
        parts.push(`${s.duration}s`);
      }
      if (s.rpe != null) {
        parts.push(`| RPE ${s.rpe}`);
      }
      return '  ' + parts.join(' ');
    })
    .join('\n');
  const target = `Target: ${ex.targetSets ?? '?'}x${ex.targetReps ?? '?'}`;
  // set-kind plan Task 1 (D4, AC-SK-2): the volume line counts only working sets against the
  // target — warm-ups still appear above in `setsDetail`, listing every set performed.
  const workingCount = workingSets(ex.sets).length;
  return (
    `Exercise '${ex.exerciseName}' completed.\n` +
    `${target}\n` +
    `Sets performed:\n${setsDetail}\n` +
    `Total: ${workingCount}/${ex.targetSets ?? '?'} sets.`
  );
}
