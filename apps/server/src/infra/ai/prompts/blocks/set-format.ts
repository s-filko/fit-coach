/**
 * Set formatters shared by the `log_set`, `update_last_set`, `delete_last_sets` and
 * `get_exercise_history` tool results (moved from the retired training-workout-overview block).
 */
import type { WorkoutSessionWithDetails } from '@domain/training/types';

/**
 * The one wording for a set with no external load (BR-TRAINING-047): `bodyweight`, written in full —
 * never `BW` (ambiguous with the user's body weight) and never a bare weightless reps count. Every
 * set text the model reads is built on it: tool confirmations print `8 reps @ bodyweight`, the facts
 * blocks print `8×bodyweight`.
 */
export const BODYWEIGHT_LABEL = 'bodyweight';

/** `8 reps @ bodyweight` — the long form of the tool confirmations and exercise summaries. */
export function formatBodyweightLong(reps: number): string {
  return `${reps} reps @ ${BODYWEIGHT_LABEL}`;
}

/** `8×bodyweight` — the short form of the facts blocks (today / history / recent history). */
export function formatBodyweightShort(reps: number): string {
  return `${reps}×${BODYWEIGHT_LABEL}`;
}

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
      if (setData.weight == null) {
        // A legacy row that never carried a load — to the model it is what it is: a bodyweight set.
        return formatBodyweightLong(setData.reps);
      }
      const perHandNote = setData.perHand ? ' per hand' : '';
      return `${setData.reps} reps @ ${setData.weight} ${setData.weightUnit ?? 'kg'}${perHandNote}`;
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
      return formatBodyweightLong(setData.reps);
    case 'isometric':
      return `${setData.duration}s hold`;
    case 'interval':
      return `${setData.rounds ?? 1} rounds: ${setData.workDuration}s on / ${setData.restDuration}s off`;
    default:
      return JSON.stringify(setData);
  }
}
