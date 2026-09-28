/**
 * Typed training errors. Pure domain: no imports.
 */

/**
 * INV-TRAINING-002: the user already has an `in_progress` session, so another one cannot be started
 * or begun. One class and one message for every path that refuses it — the service's ordinary check
 * and the repository's translation of the database's partial unique index (the race loser) — so the
 * two orderings are indistinguishable from outside.
 */
export class ActiveSessionExistsError extends Error {
  constructor() {
    super('You already have an active session. Please complete or skip it first.');
    this.name = 'ActiveSessionExistsError';
  }
}

/**
 * `TrainingService.resolveExerciseIdByName` found nothing for the given name — neither an exact
 * (ilike) match nor a semantic one. A distinct class (close-out review item 4, training-history-
 * lookup plan) so callers can tell a genuine miss apart from a systemic failure (DB/embedding
 * error) without parsing the message: `log_set`'s callers relay the message as-is either way, but
 * `get_exercise_history` needs the difference to choose `llm_error` (miss, model can recover via
 * search_exercises) vs `system_error` (nothing the model can do).
 */
export class ExerciseNotFoundError extends Error {
  constructor(exerciseName: string) {
    super(`Exercise "${exerciseName}" not found in DB. Cannot log set for unknown exercise.`);
    this.name = 'ExerciseNotFoundError';
  }
}
