import type { LoadExerciseType, LoadFacts, RepRange } from '../../load-facts';

/** Training goal family a scheme derives its default parameters from. */
export type SchemeGoal = 'strength' | 'hypertrophy' | 'general';

/** Named, cited parameters of a scheme run (plan D2, R4.0). */
export interface SchemeParams {
  /** Target rep range for range-based schemes; ignored when `fixedReps` is set. */
  repRange: RepRange;
  /** Fixed reps per set (linear progression); overrides the range. */
  fixedReps?: number;
  /** Consecutive sessions at the range top before the load grows. */
  confirmSessions: number;
  /** A load step above this share of the load progresses by reps instead. */
  stepCapPct: number;
}

/** What to do next with one exercise: a load (null = no record) and target reps. */
export interface Recommendation {
  load: number | null;
  unit: 'kg' | 'lbs' | null;
  reps: RepRange;
}

export type Confidence = 'low' | 'medium' | 'high';

export interface SchemeOutput {
  candidate: Recommendation;
  conservative: Recommendation;
  /** One printed line: why this candidate. */
  reason: string;
  confidence: Confidence;
  /** Fact names the scheme needed and did not have; each is also stated in `reason`. */
  missing: string[];
}

/** One signature for every scheme (design §4.1). */
export type SchemeDecide = (facts: LoadFacts, goal: SchemeGoal, params: SchemeParams) => SchemeOutput;

export interface ProgressionScheme {
  id: string;
  version: number;
  description: string;
  /** One-line rule the coach repeats to the user. */
  coachRule: string;
  /** Source citation (R4.0). */
  citation: string;
  applicableTo: LoadExerciseType[];
  defaultParams(goal: SchemeGoal): SchemeParams;
  decide: SchemeDecide;
}
