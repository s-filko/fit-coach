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

export type RepsVsRange = 'below floor' | 'in range' | 'at or above top';

export interface LastExposureFact {
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

export type EquipmentStepFact = Metric<{ step: number; unit: 'kg'; perHand: boolean; basis: string }>;

export interface LoadFacts {
  exerciseId: string;
  exerciseName: string;
  dataSufficiency: DataSufficiency;
  repRange: Metric<RepRangeFact>;
  reference: Metric<ReferenceFact>;
  fatigueReference: Metric<FatigueFact>;
  fatigueToday: FatigueFact;
  workingWeight: Metric<WorkingWeightFact>;
  e1rmTrend: Metric<E1rmTrendFact>;
  lastExposure: Metric<LastExposureFact>;
  gap: GapFact;
  constraints: ConstraintsFact;
  equipmentStep: EquipmentStepFact;
}
