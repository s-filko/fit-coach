/**
 * Set formatters shared by the `log_set` and `get_exercise_history` tool results (moved from the
 * retired training-workout-overview block).
 */
import type { WorkoutSessionWithDetails } from '@domain/training/types';

/**
 * One exercise's set lines (`  Set N: ...`) plus an optional `  Overall feedback: "..."` line, or
 * `  No sets logged.` — everything after the caller's own `Name [ID:...]` header line. */
export function formatExerciseSets(
  sets: WorkoutSessionWithDetails['exercises'][number]['sets'],
  userFeedback: string | null,
): string {
  if (sets.length === 0) {
    return '  No sets logged.';
  }

  const setsText = sets.map(s => {
    const base = formatSetData(s.setData);
    const kindNote = s.setKind === 'warmup' ? ' (w/u)' : '';
    const rpe = s.rpe ? ` | RPE ${s.rpe}` : '';
    const fb = s.userFeedback ? ` | "${s.userFeedback}"` : '';
    return `  Set ${s.setNumber}: ${base}${kindNote}${rpe}${fb}`;
  });

  const feedbackLine = userFeedback ? `\n  Overall feedback: "${userFeedback}"` : '';
  return `${setsText.join('\n')}${feedbackLine}`;
}

export function formatSetData(
  setData: WorkoutSessionWithDetails['exercises'][number]['sets'][number]['setData'],
): string {
  switch (setData.type) {
    case 'strength': {
      const perHandNote = setData.perHand ? ' per hand' : '';
      return `${setData.reps} reps${setData.weight != null ? ` @ ${setData.weight} ${setData.weightUnit ?? 'kg'}${perHandNote}` : ''}`;
    }
    case 'cardio_distance': {
      const durStr = setData.duration > 0 ? `${Math.round(setData.duration / 60)}min` : '?min';
      const parts: string[] = [`${setData.distance}${setData.distanceUnit}`, durStr];
      if (setData.inclinePct != null) {
        parts.push(`${setData.inclinePct}% incline`);
      }
      return parts.join(' ');
    }
    case 'cardio_duration':
      return `${setData.duration}s${setData.intensity ? ` (${setData.intensity})` : ''}`;
    case 'functional_reps':
      return `${setData.reps} reps`;
    case 'isometric':
      return `${setData.duration}s hold`;
    case 'interval':
      return `${setData.rounds ?? 1} rounds: ${setData.workDuration}s on / ${setData.restDuration}s off`;
    default:
      return JSON.stringify(setData);
  }
}
