/**
 * Plan-save name/id check (training-history-lookup plan D5): `start_training_session` and
 * `save_workout_plan` both already load the catalog rows for the ids they are about to persist
 * (`exerciseRepository.findByIdsWithMuscles`, for the missing-id check) — this checks each
 * entry's `exerciseName` against the catalog name of its `exerciseId`. Closes the gap behind BUG-030
 * D19: a session plan can name one exercise while carrying another's id (live 2026-09-25,
 * "Treadmill" naming Rowing Machine's id — BACKLOG.md § Findings).
 *
 * Match rule: words of >= 3 letters, lower-cased, Unicode-aware — any shared word passes (loose on
 * purpose: "Barbell Bench Press" vs "Bench Press" must pass). No shared word rejects the WHOLE call
 * (`llm_error`, nothing persisted) — the model is told to fix the id via `search_exercises` or use
 * the catalog name. When the check passes, every entry's `exerciseName` is replaced by the catalog
 * name (D5 / D19: the catalog is the truth for an id, not what the plan happened to call it).
 */
import { llmError, type ToolOutcome } from '@domain/conversation/tool-outcome';

export interface NamedExerciseRef {
  exerciseId: string;
  exerciseName?: string;
}

export interface NameCheckResult<T extends NamedExerciseRef> {
  /** Set when at least one entry's name shares no word with its catalog name — reject the whole call. */
  rejection: ToolOutcome | null;
  /** Same entries in the same order; `exerciseName` replaced by the catalog name where checked and matched. */
  corrected: T[];
}

const WORD_RE = /[\p{L}\p{N}]+/gu;

/** Lower-cased, Unicode-aware words of >= 3 letters — short words (a, id, ...) never count as a match. */
function wordsOf(name: string): Set<string> {
  const words = new Set<string>();
  for (const match of name.toLowerCase().matchAll(WORD_RE)) {
    if (match[0].length >= 3) {
      words.add(match[0]);
    }
  }
  return words;
}

function sharesWord(a: string, b: string): boolean {
  const wordsB = wordsOf(b);
  for (const word of wordsOf(a)) {
    if (wordsB.has(word)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks every entry's `exerciseName` (when present) against `catalogNameById`'s row for its
 * `exerciseId`. An entry with no `exerciseName`, or whose id is not in the map (the caller's
 * missing-id check runs first and would already have rejected that), passes through unchanged.
 */
export function checkExerciseNamesAgainstCatalog<T extends NamedExerciseRef>(
  entries: readonly T[],
  catalogNameById: ReadonlyMap<string, string>,
): NameCheckResult<T> {
  const mismatches: string[] = [];
  const corrected = entries.map(entry => {
    if (!entry.exerciseName) {
      return entry;
    }
    const catalogName = catalogNameById.get(entry.exerciseId);
    if (!catalogName) {
      return entry;
    }
    if (sharesWord(entry.exerciseName, catalogName)) {
      return entry.exerciseName === catalogName ? entry : { ...entry, exerciseName: catalogName };
    }
    mismatches.push(`"${entry.exerciseName}" → id is "${catalogName}"`);
    return entry;
  });

  if (mismatches.length === 0) {
    return { rejection: null, corrected };
  }
  return {
    rejection: llmError(
      `Exercise name does not match its id in the catalog: ${mismatches.join('; ')}. ` +
        'Fix the id via search_exercises, or use the catalog name.',
    ),
    corrected: entries as T[],
  };
}
