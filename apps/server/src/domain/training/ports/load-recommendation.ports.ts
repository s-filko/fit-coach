import type { WorkoutSessionWithDetails } from '@domain/training/types';

/** What the model told the user on the first working set (O1/A4); the reply text is never parsed. */
export interface LoadPlanAdvised {
  load?: number;
  reps?: number;
  /** Stated only when the advice departs from the suggestion. */
  reason?: string;
}

/** Per-call context the `log_set` tool hands to `logSetWithContext` for the recommendation log. */
export interface LoadPlanLogContext {
  runId: string | null;
  now: Date;
  timezone: string | null;
  advised?: LoadPlanAdvised;
}

/**
 * The v2 LOAD PLAN entry of one exercise as it was rendered for the run, with the decision (`decide()`) that
 * produced its numbers (A3). Decision fields are null for an exercise the schemes do not cover (non-strength);
 * `fatigue` is the fact package's fatigue context.
 */
export interface LoadPlanSnapshot {
  rendered: string;
  fatigue: unknown;
  schemeId: string | null;
  schemeVersion: string | null;
  stage: string | null;
  row: string | null;
  candidate: unknown;
  conservative: unknown;
  confidence: string | null;
  gapTier: string | null;
}

/** Snapshot port: renders the v2 entry and its decision for one exercise; null when there is nothing to render. */
export interface ILoadPlanSnapshotPort {
  snapshot(input: {
    userId: string;
    session: WorkoutSessionWithDetails;
    exerciseId: string;
    now: Date;
    timezone: string | null;
  }): Promise<LoadPlanSnapshot | null>;
}

export interface NewLoadRecommendation extends LoadPlanSnapshot {
  userId: string;
  sessionId: string;
  sessionExerciseId: string;
  exerciseId: string;
  runId: string | null;
  advised: LoadPlanAdvised | null;
}

export interface LoadRecommendationOutcome {
  sets: {
    setNumber: number;
    reps?: number;
    weight?: number;
    weightUnit?: string;
    duration?: number;
    rpe: number | null;
  }[];
}

export interface ILoadRecommendationRepository {
  /** One row per session exercise: a second insert for the same row is a no-op. */
  insertFirstWorkingSet(row: NewLoadRecommendation): Promise<void>;
  /** Fills `outcome` + `completed_at` once; a row already completed (or absent) is left alone. */
  recordOutcome(sessionExerciseId: string, outcome: LoadRecommendationOutcome, completedAt: Date): Promise<void>;
}

/** A snapshot taken before the set was stored, waiting to be written after it. */
export type PendingLoadRecommendation = NewLoadRecommendation;

/**
 * The training service's view of the recommendation log (D7). Calibration data, never read back
 * into a prompt. Implementations never throw — a log failure must not fail a logged set.
 */
export interface ILoadRecommendationLog {
  /**
   * Snapshot BEFORE the set is stored (so "today" excludes it); null = nothing to write — including when the
   * exercise already has a working set (D7 trigger: the first working set only). The implementation reads the
   * session itself, inside its never-throw guard.
   */
  prepare(input: {
    sessionId: string;
    sessionExerciseId: string;
    exerciseId: string;
    ctx: LoadPlanLogContext;
  }): Promise<PendingLoadRecommendation | null>;
  /** Persist a prepared snapshot after the set was stored. */
  commit(pending: PendingLoadRecommendation): Promise<void>;
  recordOutcome(sessionExerciseId: string, outcome: LoadRecommendationOutcome): Promise<void>;
}
