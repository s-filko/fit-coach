// Training service port

import type {
  CreateSessionDto,
  CreateSessionExerciseDto,
  CreateSessionSetDto,
  SessionExercise,
  SessionRecommendation,
  SessionSet,
  SetData,
  SetKind,
  WorkoutPlan,
  WorkoutSession,
  WorkoutSessionWithDetails,
} from '@domain/training/types';

// --- DI Tokens ---

export const TRAINING_SERVICE_TOKEN = Symbol('TrainingService');

// --- Result Types ---

/** Per-set detail included in exercise completion summaries so the LLM can cite exact data. */
export interface CompletedSetDetail {
  setNumber: number;
  reps?: number;
  weight?: number;
  weightUnit?: string;
  duration?: number;
  rpe: number | null;
  // set-kind plan Task 1 (D4): optional — legacy fixtures/stubs that never set it are treated as
  // working by `workingSets` (undefined/null !== 'warmup').
  setKind?: SetKind | null;
}

/** Metadata returned when an exercise is completed (explicitly or auto-completed on switch). */
export interface AutoCompletedExercise {
  exerciseId: string;
  exerciseName: string;
  setsLogged: number;
  sets: CompletedSetDetail[];
  targetSets?: number | null;
  targetReps?: string | null;
  targetWeight?: string | null;
}

/** Return type for ensureCurrentExercise — includes optional auto-complete metadata. */
export interface EnsureExerciseResult {
  exercise: SessionExercise;
  autoCompleted?: AutoCompletedExercise;
}

/** Details of a single deleted set, returned by deleteLastSets for LLM to relay to the user. */
export interface DeletedSetDetail {
  setNumber: number;
  setData: SessionSet['setData'];
  rpe: number | null;
}

export interface DeletedSetsResult {
  exerciseId: string;
  deletedSets: DeletedSetDetail[];
}

/** Before/after diff returned by updateLastSet. */
export interface UpdateSetResult {
  exerciseId: string;
  setNumber: number;
  before: Pick<SessionSet, 'setData' | 'rpe' | 'userFeedback' | 'setKind'>;
  after: Pick<SessionSet, 'setData' | 'rpe' | 'userFeedback' | 'setKind'>;
}

// --- Service Interface ---

export interface ITrainingService {
  getActivePlan(userId: string): Promise<WorkoutPlan | null>;
  updateSessionPlan(sessionId: string, exercises: SessionRecommendation['exercises']): Promise<WorkoutSession>;
  startSession(userId: string, dto: CreateSessionDto): Promise<WorkoutSession>;
  beginSession(sessionId: string): Promise<WorkoutSession>;
  addExerciseToSession(sessionId: string, dto: CreateSessionExerciseDto): Promise<SessionExercise>;
  logSet(exerciseId: string, dto: CreateSessionSetDto): Promise<SessionSet>;
  completeSession(sessionId: string, durationMinutes?: number, completedAt?: Date): Promise<WorkoutSession>;
  skipSession(sessionId: string): Promise<WorkoutSession>;
  // set-kind plan Task 2 (D6): set where today's session is happening, in the user's own words.
  setSessionPlace(sessionId: string, place: string): Promise<WorkoutSession>;
  getActiveSession(userId: string): Promise<WorkoutSessionWithDetails | null>;
  getTrainingHistory(userId: string, limit?: number): Promise<WorkoutSessionWithDetails[]>;
  getSessionDetails(sessionId: string): Promise<WorkoutSessionWithDetails | null>;

  /**
   * INV-TRAINING-005 (BUG-053): closes the user's in_progress sessions idle past the timeout —
   * at most one exists (INV-TRAINING-002) — through the timeout auto-close path: status
   * 'completed', `auto_close_reason = 'timeout'`, `completed_at` = the last activity
   * (INV-TRAINING-006), after the same finish reconciliation `completeSession` runs. Exposed for
   * `prepare`, which calls it at the user's next message before the phase runs.
   */
  autoCloseTimedOutSessions(userId: string): Promise<void>;

  /**
   * BUG-053 T5 (AC-SSA-5): the user's most recent `completed` session (any close reason) with its
   * exercises and sets — the one `edit_last_workout` edits in place — or null when there is none.
   */
  getLastFinishedSession(userId: string): Promise<WorkoutSessionWithDetails | null>;

  // Exercise management during training
  completeCurrentExercise(sessionId: string): Promise<AutoCompletedExercise>;

  // Lazily ensure an in_progress exercise exists (creates from plan or ad-hoc if needed).
  // Auto-completes the current in_progress exercise when switching to a different exerciseId.
  ensureCurrentExercise(
    sessionId: string,
    opts?: { exerciseId?: string; exerciseName?: string },
  ): Promise<EnsureExerciseResult>;

  // Correction tools (ADR-0011 Phase 2)
  deleteLastSets(sessionId: string, exerciseId: string, count?: number): Promise<DeletedSetsResult>;
  updateLastSet(
    sessionId: string,
    exerciseId: string,
    updates: {
      rpe?: number;
      feedback?: string;
      weight?: number;
      reps?: number;
      durationSeconds?: number;
      distanceKm?: number;
      inclinePct?: number;
      // set-kind plan Task 1 (D3, AC-SK-8)
      setKind?: SetKind;
    },
    // AC-SSA-5: names the set to update; absent = the exercise's last set.
    opts?: { setNumber?: number },
  ): Promise<UpdateSetResult>;
  // AC-SSA-5: deletes one numbered set of an exercise.
  deleteSet(sessionId: string, exerciseId: string, setNumber: number): Promise<DeletedSetsResult>;

  /**
   * Resolves an exercise name to its catalog id (exact ilike match, then semantic search) — the
   * same resolver `logSetWithContext`/`ensureCurrentExercise` use for a name-only `log_set` call.
   * `get_exercise_history` reuses it (training-history-lookup plan D2) rather than copying it.
   * Throws when nothing resolves.
   */
  resolveExerciseIdByName(exerciseName: string): Promise<string>;

  // Log a set for the current exercise, auto-computing setNumber from existing sets in DB
  logSetWithContext(
    sessionId: string,
    opts: {
      exerciseId?: string;
      exerciseName?: string;
      setData: SetData;
      rpe?: number;
      feedback?: string;
      createdAt?: Date;
      skipActivityUpdate?: boolean;
      // set-kind plan Task 1 (D2, D3): defaults to 'working' when absent.
      setKind?: SetKind;
      // set-kind plan Task 1 (D5): 'total' overrides the per-hand default on a dumbbell/kettlebell
      // exercise — the user explicitly stated a combined weight.
      weightBasis?: 'total';
      // AC-SSA-5: the session is completed and edited in place — exercise statuses and the session's
      // activity clock stay as they are (implies skipActivityUpdate); a new exercise row is `completed`.
      finishedSession?: boolean;
      // AC-PTF-7: the caller passed reps without any weight — the exercise's weight_mode decides
      // whether that is a bodyweight set (optional) or a WeightRequiredError (required).
      weightOmitted?: boolean;
    },
  ): Promise<{ set: SessionSet; setNumber: number; autoCompleted?: AutoCompletedExercise }>;
}
