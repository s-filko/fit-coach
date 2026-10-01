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

/**
 * The concrete condition of the next increase (or the way back), printed as the `next step:` line. Domain data only —
 * the words live in the block (ADR-0013 D-09). Loads are in the recommendation's unit.
 */
export type NextStep =
  /** Growth waits for `sessions` more session(s) with the last set at the working weight ≥ `reps`; `load` is next. */
  | { kind: 'growth'; sessions: number; reps: number; load: number; capped?: boolean }
  /** Growth was just recommended: after it the same rule applies at `load` (range top `reps`). */
  | { kind: 'after_growth'; load: number; reps: number; capped?: boolean }
  /** The return ladder: `remaining` more workouts until back at `backTo`; `cold` = a restart cold start. */
  | { kind: 'ladder'; remaining: number; backTo: number; cold: boolean }
  /** Uneven performance: even sets (reps falling by at most `maxDrop`) at `load` → the growth rule applies. */
  | { kind: 'uneven'; load: number; maxDrop: number }
  /** After a step down: back to `backTo` when the sets at `atLoad` reach `reps`. */
  | { kind: 'step_down'; backTo: number; atLoad: number; reps: number }
  /** A set stopped below the floor with reps in reserve: take it to the floor next time at `load`. */
  | { kind: 'early_stop'; load: number; reps: number }
  /** One below-floor set without RPE: the answer to "how many more reps" decides between hold and `stepDownTo`. */
  | { kind: 'ask_effort'; load: number; stepDownTo: number }
  | { kind: 'constraint' }
  | { kind: 'pre_fatigue'; load: number }
  /** A number exists, but not a working weight yet; `why` is the working-weight fact's absent reason. */
  | { kind: 'insufficient'; why: string }
  | { kind: 'no_number' }
  /** Unknown step and no heavier load on record: ask which heavier load the equipment has (no number). */
  | { kind: 'ask_heavier' }
  /** The working weight is an indirect estimate; sets at `load` reaching `reps` confirm it. */
  | { kind: 'estimated'; load: number; reps: number }
  /** Nothing to wait for or a data gap: `why` is a short domain phrase. */
  | { kind: 'hold'; why: string };

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
  next: NextStep;
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
