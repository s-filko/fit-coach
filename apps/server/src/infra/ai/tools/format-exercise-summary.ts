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
 * Which tool produced the summary — decides the instruction text that follows the facts
 * (BUG-037: the two paths teach the model opposite reply orders).
 * - `explicit`: complete_current_exercise — the user ASKED to move on, so the summary is
 *   the answer and announcing the next exercise is wanted.
 * - `set-triggered`: log_set for a different exercise — the set the user just reported is
 *   the news; the finished-exercise recap is a brief aside at the end.
 */
export type ExerciseSummaryMode = 'set-triggered' | 'explicit';

const EXPLICIT_INSTRUCTION =
  'Summarize this exercise for the user: list the sets, analyze RPE trend, compare to target, give a coaching comment. Then announce the next exercise from SESSION PLAN.';

const SET_TRIGGERED_INSTRUCTION =
  'The user just reported a set of a new exercise, which auto-completed this one. First confirm the set the user just reported (the confirmation above this summary) and reply to what they said. At the end, add a brief recap (1-2 lines) of this completed exercise — total volume vs target and one coaching comment. Do not introduce or suggest a next exercise: the user has already moved on to one.';

/**
 * Load plan (load-plan plan Task 5b, D10): `omitTargetWeight` (LOAD_PLAN_PLANNER_REBIND on) drops the
 * plan target weight from the Target line — sets × reps only; the logged sets always keep their weights.
 */
export function formatExerciseSummary(
  ex: AutoCompletedExercise,
  mode: ExerciseSummaryMode = 'explicit',
  opts: { omitTargetWeight?: boolean } = {},
): string {
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
  const targetWeightStr = !opts.omitTargetWeight && ex.targetWeight ? ` @ ${ex.targetWeight} kg` : '';
  const target = `Target: ${ex.targetSets ?? '?'}x${ex.targetReps ?? '?'}${targetWeightStr}`;
  // set-kind plan Task 1 (D4, AC-SK-2): the volume line counts only working sets against the
  // target — warm-ups still appear above in `setsDetail`, listing every set performed.
  const workingCount = workingSets(ex.sets).length;
  return (
    `Exercise '${ex.exerciseName}' completed.\n` +
    `${target}\n` +
    `Sets performed:\n${setsDetail}\n` +
    `Total: ${workingCount}/${ex.targetSets ?? '?'} sets.\n` +
    (mode === 'set-triggered' ? SET_TRIGGERED_INSTRUCTION : EXPLICIT_INSTRUCTION)
  );
}
