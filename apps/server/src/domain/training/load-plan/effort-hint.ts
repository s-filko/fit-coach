import { parseRepRange } from '../load-facts';

/**
 * The effort hint (load-plan-fixes item 10, owner 2026-10-01): when `log_set` stores a decision-critical set without
 * RPE, its tool result tells the coach to ask the client one plain-language question. The code decides when; the model
 * only asks. Pure over the set, the exercise's earlier sets of this session and the plan target.
 */

/** A set ≥ this many reps above the top of the range is decision-critical (the opener included). */
export const HINT_ABOVE_TOP = 3;

export interface HintSet {
  reps: number;
  /** null / 0 = no load (bodyweight, isometric): not a load decision. */
  weight: number | null;
  rpe: number | null;
  feedback: string | null;
  isWarmup: boolean;
}

export interface EffortHintInput {
  /** The set just stored. */
  set: HintSet;
  /** This exercise's earlier sets in the session, in order (warm-ups included, they are skipped). */
  earlier: HintSet[];
  /** `session_exercises.target_reps` text (e.g. "8-10"), null when none. */
  targetReps: string | null;
  /** Planned working sets of the exercise, null when unknown. */
  targetSets: number | null;
}

type Critical = 'below the rep floor' | 'above the rep range by 3+ reps' | 'the last planned set';

function criticalReason(
  set: HintSet,
  workingIndex: number,
  range: { min: number; max: number } | null,
  targetSets: number | null,
): Critical | null {
  if (range && set.reps < range.min) {
    return 'below the rep floor';
  }
  if (range && set.reps >= range.max + HINT_ABOVE_TOP) {
    return 'above the rep range by 3+ reps';
  }
  return targetSets !== null && workingIndex >= targetSets ? 'the last planned set' : null;
}

const isLoadedWorking = (s: HintSet): boolean => !s.isWarmup && s.weight !== null && s.weight > 0;

export const EFFORT_QUESTION = 'Сколько ещё раз смог бы сделать на этом весе? 0, 1–2 или 3 и больше?';

/** The hint text for the tool result, or null when no hint is due. */
export function effortHint(input: EffortHintInput): string | null {
  const { set, earlier } = input;
  if (!isLoadedWorking(set) || set.rpe !== null || (set.feedback ?? '').trim() !== '') {
    return null;
  }
  const range = parseRepRange(input.targetReps);
  const working = earlier.filter(isLoadedWorking);
  // The user already speaks RPE on this exercise, or an earlier critical set already got the hint.
  if (working.some(s => s.rpe !== null)) {
    return null;
  }
  const alreadyHinted = working.some(
    (s, i) => criticalReason(s, i + 1, range, input.targetSets) !== null && (s.feedback ?? '').trim() === '',
  );
  const reason = criticalReason(set, working.length + 1, range, input.targetSets);
  if (reason === null || alreadyHinted) {
    return null;
  }
  return [
    `Effort hint: this set is decision-critical (${reason}) and was stored without RPE.`,
    `Ask once, in plain words: «${EFFORT_QUESTION}»`,
    'Then record the answer on this set with update_last_set rpe (0 → 10, 1–2 → 8, 3+ → 7).',
    'Do not ask again for this exercise today.',
  ].join(' ');
}
