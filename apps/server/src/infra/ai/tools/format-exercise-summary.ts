import type { AutoCompletedExercise } from '@domain/training/ports';

/** A training session idle longer than this is considered stale/retro-logging territory. */
export const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Retro-logged sets are offset from the last real activity by this much. */
export const RETRO_SET_OFFSET_MS = 5 * 60 * 1000;

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

export function formatExerciseSummary(ex: AutoCompletedExercise, mode: ExerciseSummaryMode = 'explicit'): string {
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
  const targetWeightStr = ex.targetWeight ? ` @ ${ex.targetWeight} kg` : '';
  const target = `Target: ${ex.targetSets ?? '?'}x${ex.targetReps ?? '?'}${targetWeightStr}`;
  return (
    `Exercise '${ex.exerciseName}' completed.\n` +
    `${target}\n` +
    `Sets performed:\n${setsDetail}\n` +
    `Total: ${ex.setsLogged}/${ex.targetSets ?? '?'} sets.\n` +
    (mode === 'set-triggered' ? SET_TRIGGERED_INSTRUCTION : EXPLICIT_INSTRUCTION)
  );
}
