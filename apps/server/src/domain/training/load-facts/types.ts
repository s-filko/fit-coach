import type { Involvement, MuscleGroup, SetData, SetKind } from '../types';

/**
 * load-facts plan Task 1 (D4, D9): plain input/output types for the pure load metrics. Inputs are
 * flat data the infra loader (Task 3) builds from repository rows; nothing here imports a
 * repository, and no function reads a clock — `now` and `timezone` are arguments.
 */

// --- Output primitives ---

/** A metric that cannot be computed: the reason is printed in place of the value. */
export interface Absent {
  absent: string;
}
export type Metric<T> = T | Absent;

export function isAbsent(value: unknown): value is Absent {
  return typeof value === 'object' && value !== null && 'absent' in value;
}

// --- Inputs ---

export type EquipmentKind = 'barbell' | 'dumbbell' | 'bodyweight' | 'machine' | 'cable' | 'none';
export type LoadExerciseType =
  | 'strength'
  | 'cardio_distance'
  | 'cardio_duration'
  | 'functional_reps'
  | 'isometric'
  | 'interval';

export interface ExerciseInput {
  id: string;
  name: string;
  exerciseType: LoadExerciseType;
  equipment: EquipmentKind;
  muscles: { muscleGroup: MuscleGroup; involvement: Involvement }[];
}

/** One logged set of the exercise (`session_sets` row). */
export interface SetInput {
  setData: SetData;
  /** NULL/undefined = legacy row, classified by the D7 heuristic. */
  setKind?: SetKind | null;
  rpe: number | null;
  userFeedback: string | null;
  createdAt: Date;
}

/** A set logged on another exercise of the same session — input for the fatigue context. */
export interface OtherSetInput {
  /** Identifies the other exercise within its session — the D7 heuristic runs per exercise. */
  exerciseRowId: string;
  exerciseName: string;
  setData: SetData;
  /** All muscles of that exercise (primary and secondary). */
  muscles: { muscleGroup: MuscleGroup; involvement: Involvement }[];
  setKind?: SetKind | null;
  createdAt: Date;
}

/** Facts about one session, shared by past performances and today. */
interface SessionSlice {
  /** Trimmed, case-insensitive compared; null/blank = unknown. */
  place: string | null;
  /** `workout_sessions.startedAt`; falls back to the first set when null. */
  startedAt: Date | null;
  /** This exercise's sets in this session (any order). */
  sets: SetInput[];
  /** Sets on the session's other exercises (any order, any timestamp). */
  otherSets: OtherSetInput[];
  /** `session_exercises.target_reps` text (e.g. "8-12"), null when none. */
  targetReps: string | null;
}

/** A past performance of the exercise in a completed session. */
export interface PerformanceInput extends SessionSlice {
  /** Opaque id of the `session_exercises` row — lets the renderer match EXERCISE HISTORY (D2). */
  id: string;
  sessionId: string;
  /** Session completion time, else start — the date the performance is "on". */
  performedAt: Date;
}

/** Today's session, for this exercise: a session plan item's target reps go in `targetReps`. */
export interface TodayInput extends SessionSlice {
  sessionId: string;
}

/** A real (completed) workout, for the gap metric. */
export interface WorkoutSummaryInput {
  sessionId: string;
  performedAt: Date;
  /** Muscle groups with primary involvement across the workout's exercises. */
  primaryMuscles: MuscleGroup[];
}

export interface ConstraintInput {
  /** Set by `computeConstraints`: the muscle is a PRIMARY one of the exercise (absent = treated as primary). */
  onPrimary?: boolean;
  muscleGroup: MuscleGroup | null;
  durability: 'short' | 'long_term' | 'permanent';
  text: string;
}

export interface LoadFactsContext {
  /** Active `physical_constraint` facts. */
  constraints: ConstraintInput[];
  /** Active `equipment` facts, as text. */
  equipmentFacts: string[];
  /** Real workouts in the loaded window (today's may be present; it is filtered out). */
  workouts: WorkoutSummaryInput[];
  /** All-time real performances of this exercise, when the loader counted them. */
  allTimePerformances?: number;
}

// --- Outputs ---

export interface RepRange {
  min: number;
  max: number;
}
export interface RepRangeFact extends RepRange {
  source: 'today' | 'reference';
}

export interface DataSufficiency {
  last56Days: number;
  allTime: number;
}

export type NotLikeForLikeReason = 'place' | 'reps';

export interface ReferenceFact {
  performance: PerformanceInput;
  daysAgo: number;
  /** Working sets of the performance (D7 applied), in input order by time. */
  sets: SetInput[];
  /** True, or the reasons this candidate is not like-for-like (D6 fallback). */
  likeForLike: true | { notLikeForLike: NotLikeForLikeReason[] };
  warmupsEstimated: boolean;
  rpe: number[];
  /** `userFeedback` of the working sets, verbatim. */
  feedback: string[];
}

export interface FatigueFact {
  /** Muscles shared with this exercise, most working sets first. Empty = fresh. */
  perMuscle: { muscleGroup: MuscleGroup; workingSets: number; exerciseNames: string[] }[];
  fresh: boolean;
  minutesIntoSession: Metric<number>;
  /** Today's only: per-muscle counts equal the reference's. */
  sameAsReference?: boolean;
}

export interface WorkingWeightFact {
  weight: number;
  unit: 'kg' | 'lbs' | null;
  performances: number;
  warmupsEstimated: boolean;
  mixedBasisExcluded: number;
  /** Set when the weight came from the indirect Epley estimate (the set it was read from), not from a reached load. */
  estimatedFrom?: { weight: number; reps: number };
}

/** The load the newest single performance points to (ruling G-11): the insufficient-data reference load. */
export interface IndicativeLoadFact {
  weight: number;
  unit: 'kg' | 'lbs' | null;
  /** Set when the load is the indirect estimate from a short set, not a reached load. */
  estimatedFrom?: { weight: number; reps: number };
}

export interface E1rmTrendFact {
  newest: number;
  oldest: number;
  changePct: number;
  trend: 'rising' | 'flat' | 'falling';
  /** Consecutive newest performances within ±2.5 % of the newest (the newest counts). */
  flatRun: number;
  /** Top working load of the newest performance — the weight `weeksAtWeight` refers to. */
  currentLoad: number;
  currentLoadUnit: 'kg' | 'lbs' | null;
  weeksAtWeight: number;
  performances: number;
  /** Calendar days between the oldest and the newest performance the trend covers (load-plan D6: printed span). */
  spanDays: number;
  lowConfidence: 'machine' | null;
  warmupsEstimated: boolean;
  mixedBasisExcluded: number;
}

/** One performance's sets at the working weight (load-plan-fixes items 5–7); a probe at another load is not here. */
export interface RepHistoryEntry {
  daysAgo: number;
  /** Reps of the working sets done at the working weight, in set order; empty = the performance used another load. */
  repsAtWorkingWeight: number[];
  /** RPE of the last set at the working weight, null when not recorded. */
  lastSetRpe: number | null;
}

export interface RepHistoryFact {
  weight: number;
  unit: 'kg' | 'lbs' | null;
  /** The performances behind the working weight (the same set as metric 4), newest first. */
  entries: RepHistoryEntry[];
}

export interface VolumeFact {
  unit: 'kg' | 'lbs' | null;
  newest: { volume: number; daysAgo: number };
  previous: { volume: number; daysAgo: number };
  /** (newest − previous) / previous, in percent. */
  changePct: number;
}

export type RepsVsRange = 'below floor' | 'in range' | 'at or above top';

/** Effort read from the newest performance's sets at the working weight (reps in reserve, load-plan-fixes item 10). */
export interface EffortFact {
  /** A set below the floor at RPE ≤ 7 whose capacity still reaches the floor: stopped early, not failed. */
  earlyStop: boolean;
  /** Exactly one set is below the floor and it has no RPE — an early stop cannot be told from a failure. */
  unclearBelowFloor: boolean;
  /** The set behind either flag (reps, RPE); null when neither is set. */
  set: { reps: number; rpe: number | null } | null;
}

export interface LastExposureFact {
  effort: EffortFact;
  repsVsRange: Metric<RepsVsRange>;
  rpe: Metric<{ values: number[] }>;
  dropOff: Metric<{ value: number; usual: number | null }>;
  warmupsEstimated: boolean;
}

export type GapDays = Metric<{ days: number }>;
export interface GapFact {
  exercise: GapDays;
  primaryMuscles: GapDays;
  anyWorkout: GapDays;
}

export interface ConstraintsFact {
  constraints: ConstraintInput[];
  equipment: string[];
}

export type EquipmentStepFact = Metric<{
  step: number;
  unit: 'kg';
  perHand: boolean;
  basis: string;
  /**
   * Whether the "one step ≤ ~10 % of the load" cap applies (owner ruling O-2): false for machines and cables, whose
   * displayed load excludes the machine's own weight, so a step is relatively small whatever the displayed figure.
   */
  capApplies: boolean;
}>;

export interface LoadFacts {
  exerciseId: string;
  exerciseName: string;
  dataSufficiency: DataSufficiency;
  repRange: Metric<RepRangeFact>;
  reference: Metric<ReferenceFact>;
  fatigueReference: Metric<FatigueFact>;
  fatigueToday: FatigueFact;
  workingWeight: Metric<WorkingWeightFact>;
  /** The newest performance's own working-weight reading, with no minimum count — for the insufficient-data path. */
  indicativeLoad: Metric<IndicativeLoadFact>;
  e1rmTrend: Metric<E1rmTrendFact>;
  /** Sets at the working weight per performance — the evidence of the growth rule (load-plan-fixes item 5). */
  repHistory: Metric<RepHistoryFact>;
  /** Context only: no decision reads it (load-plan-fixes item 8). */
  volume: Metric<VolumeFact>;
  lastExposure: Metric<LastExposureFact>;
  gap: GapFact;
  constraints: ConstraintsFact;
  equipmentStep: EquipmentStepFact;
}
