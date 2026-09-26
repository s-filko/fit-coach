/**
 * Plan-save name/id check (training-history-lookup plan D5): `start_training_session` and
 * `save_workout_plan` both already load the catalog rows for the ids they are about to persist
 * (`exerciseRepository.findByIdsWithMuscles`, for the missing-id check) — this checks each
 * entry's `exerciseName` against the catalog name of its `exerciseId`. Closes the gap behind BUG-030
 * D19: a session plan can name one exercise while carrying another's id (live 2026-09-25,
 * "Treadmill" naming Rowing Machine's id — BACKLOG.md § Findings).
 *
 * Match rule (close-out review items 2/3, then widened to containment by D16): tokenise both names
 * — lower-cased, Unicode-aware words of >= 3 letters, equipment/modifier STOP_WORDS removed
 * (D-stopwords below) — then CONTAIN, not merely overlap: every word of the SHORTER remaining word
 * list must match some word of the other (exactly, or by a >= 4-char shared prefix whose extra tail
 * is <= 3 chars — covers plural/compound drift: "Squats"/"Squat", "Lunges"/"Lunge",
 * "Pullups"/"Pull-ups", but not "Dead Bug"/"Deadlift", whose shared "dead" prefix has a 4-char tail).
 * Any-overlap alone was wrong: "Leg Curl" would have passed against "Leg Extension" on "leg" alone.
 * If either side has NO words left after stop-word removal (e.g. "Smith Machine" — both words are
 * equipment), the (trivially empty) shorter side's "every word matches" holds vacuously — accept.
 * No match rejects the WHOLE call (`llm_error`, nothing persisted) — the model is told to fix the id
 * via `search_exercises` or use the English catalog name (the catalog is English-only, so a
 * non-English name — e.g. "Жим лёжа" — is always rejected, correctly). When the check passes, every
 * entry's `exerciseName` is replaced by the catalog name (D5 / D19: the catalog is the truth for an
 * id, not what the plan happened to call it).
 */
import { llmError, type ToolOutcome } from '@domain/conversation/tool-outcome';

export interface NamedExerciseRef {
  exerciseId: string;
  exerciseName?: string;
}

export interface NameCheckResult<T extends NamedExerciseRef> {
  /** Set when at least one entry's name shares no word/prefix with its catalog name — reject the whole call. */
  rejection: ToolOutcome | null;
  /** Same entries in the same order; `exerciseName` replaced by the catalog name where checked and matched. */
  corrected: T[];
}

const WORD_RE = /[\p{L}\p{N}]+/gu;
const MIN_WORD_LENGTH = 3;
const MIN_SHARED_PREFIX = 4;
/**
 * The longer word's tail beyond the shared prefix must be short too (D16) — "pull"/"pullups" (tail
 * "ups", 3) is plural/compound drift; "dead"/"deadlift" (tail "lift", 4) is two different exercises
 * that merely start the same way. Without this cap the prefix rule alone would wrongly accept
 * "Dead Bug" against "Deadlift".
 */
const MAX_PREFIX_TAIL = 3;

/**
 * D-stopwords (close-out review item 3): equipment/modifier words that name almost every exercise
 * of a kind and so prove nothing about WHICH one — sharing one of these must never pass the check
 * by itself ("Barbell Row" sharing "barbell" with "Barbell Bench Press" is not evidence of a
 * correct id). Deliberately excludes "leg": it is a body part, not equipment or a modifier
 * ("45° Leg Press" must still match "Leg Press" on "leg" + "press").
 */
const STOP_WORDS = new Set([
  'barbell',
  'dumbbell',
  'cable',
  'machine',
  'lever',
  'seated',
  'standing',
  'incline',
  'decline',
  'plate',
  'loaded',
  'smith',
  'rope',
  'grip',
  'wide',
  'narrow',
  'close',
  'single',
  'arm',
]);

/** Lower-cased, Unicode-aware words of >= 3 letters, with equipment/modifier stop words removed. */
function wordsOf(name: string): string[] {
  const words: string[] = [];
  for (const [word] of name.toLowerCase().matchAll(WORD_RE)) {
    if (word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word)) {
      words.push(word);
    }
  }
  return words;
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) {
    i += 1;
  }
  return i;
}

/** Exact match, or a shared prefix of >= 4 chars whose longer-word tail is <= 3 chars (D16). */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const prefixLen = commonPrefixLength(a, b);
  if (prefixLen < MIN_SHARED_PREFIX) {
    return false;
  }
  return Math.max(a.length, b.length) - prefixLen <= MAX_PREFIX_TAIL;
}

/**
 * Containment (D16, close-out review advisory): every word of the SHORTER (non-stop-word) list must
 * match some word of the other — not merely "some word in common", which let "Leg Curl" pass against
 * "Leg Extension" on "leg" alone. `Array.prototype.every` on an empty list is vacuously true, so a
 * name reduced to nothing by stop-word removal (e.g. "Smith Machine") accepts automatically — there
 * is nothing left to contradict the other side.
 */
function isContainedIn(shorter: string[], longer: string[]): boolean {
  return shorter.every(word => longer.some(other => wordsMatch(word, other)));
}

function sharesWord(a: string, b: string): boolean {
  const wordsA = wordsOf(a);
  const wordsB = wordsOf(b);
  return wordsA.length <= wordsB.length ? isContainedIn(wordsA, wordsB) : isContainedIn(wordsB, wordsA);
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
        'Fix the id via search_exercises, or use the English catalog name.',
    ),
    corrected: entries as T[],
  };
}
