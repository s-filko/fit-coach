import type { AutoCompletedExercise } from '@domain/training/ports';

/** A training session idle longer than this is considered stale/retro-logging territory. */
export const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Retro-logged sets are offset from the last real activity by this much. */
export const RETRO_SET_OFFSET_MS = 5 * 60 * 1000;

/** Reads the current session id the executor put into the tool config. */
export function sessionIdOf(config: { configurable?: Record<string, unknown> } | undefined): string | null {
  const sessionId = config?.configurable?.['activeSessionId'];
  return typeof sessionId === 'string' && sessionId ? sessionId : null;
}

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
  const targetWeightStr = ex.targetWeight ? ` @ ${ex.targetWeight} kg` : '';
  const target = `Target: ${ex.targetSets ?? '?'}x${ex.targetReps ?? '?'}${targetWeightStr}`;
  return (
    `Exercise '${ex.exerciseName}' completed.\n` +
    `${target}\n` +
    `Sets performed:\n${setsDetail}\n` +
    `Total: ${ex.setsLogged}/${ex.targetSets ?? '?'} sets.\n` +
    'Summarize this exercise for the user: list the sets, analyze RPE trend, compare to target, give a coaching comment. Then announce the next exercise from SESSION PLAN.'
  );
}
