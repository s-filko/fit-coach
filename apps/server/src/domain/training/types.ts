// Training domain types

// --- User Profile (subset for training context) ---

export interface UserProfile {
  id: string;
  gender: string | null;
  age: number | null;
  height: number | null;
  weight: number | null;
  fitnessGoal: string | null;
  fitnessLevel: string | null;
}

// --- Exercise Types ---

export type ExerciseType =
  | 'strength'
  | 'cardio_distance'
  | 'cardio_duration'
  | 'functional_reps'
  | 'isometric'
  | 'interval';

export type MuscleGroup =
  | 'chest'
  | 'back_lats'
  | 'back_traps'
  | 'shoulders_front'
  | 'shoulders_side'
  | 'shoulders_rear'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'abs'
  | 'lower_back'
  | 'core'
  | 'cardio_system'
  | 'full_body'
  | 'lower_body_endurance'
  | 'core_stability';

export type WorkoutPlanStatus = 'draft' | 'active' | 'archived';
export type SessionStatus = 'planning' | 'in_progress' | 'completed' | 'skipped';
export type SessionExerciseStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export type EnergyCost = 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
export type Complexity = 'beginner' | 'intermediate' | 'advanced';
export type Involvement = 'primary' | 'secondary';

// --- Exercise Catalog ---

export interface Exercise {
  id: number;
  name: string;
  category: 'compound' | 'isolation' | 'cardio' | 'functional' | 'mobility';
  equipment: 'barbell' | 'dumbbell' | 'bodyweight' | 'machine' | 'cable' | 'none';
  exerciseType: ExerciseType;
  description: string | null;
  energyCost: EnergyCost;
  complexity: Complexity;
  typicalDurationMinutes: number;
  requiresSpotter: boolean;
  imageUrl: string | null;
  videoUrl: string | null;
  createdAt: Date;
}

export interface ExerciseMuscleGroup {
  exerciseId: number;
  muscleGroup: MuscleGroup;
  involvement: Involvement;
}

export interface ExerciseWithMuscles extends Exercise {
  muscleGroups: Array<{
    muscleGroup: MuscleGroup;
    involvement: Involvement;
  }>;
}

// --- Workout Plan ---

export interface RecoveryGuidelines {
  majorMuscleGroups: { minRestDays: number; maxRestDays: number };
  smallMuscleGroups: { minRestDays: number; maxRestDays: number };
  highIntensity: { minRestDays: number };
  cardio?: { minRestDays: number; maxRestDays: number };
  functional?: { minRestDays: number; maxRestDays: number };
  customRules: string[];
}

export interface SessionTemplateExercise {
  exerciseId: number;
  exerciseName: string;
  energyCost: EnergyCost;
  targetSets: number;
  targetReps: string; // e.g., '8-10', '12-15'
  targetWeight?: number;
  restSeconds: number;
  estimatedDuration: number; // minutes
  notes?: string;
}

export interface SessionTemplate {
  key: string; // e.g., 'upper_a', 'lower_b'
  name: string;
  focus: string;
  energyCost: EnergyCost;
  estimatedDuration: number;
  exercises: SessionTemplateExercise[];
}

export interface WorkoutPlanJson {
  goal: string;
  trainingStyle: string;
  targetMuscleGroups: MuscleGroup[];
  recoveryGuidelines: RecoveryGuidelines;
  sessionTemplates: SessionTemplate[];
  progressionRules: string[];
}

export interface WorkoutPlan {
  id: string;
  userId: string;
  name: string;
  planJson: WorkoutPlanJson;
  status: WorkoutPlanStatus;
  createdAt: Date;
  updatedAt: Date;
}

// --- Workout Session ---

export interface UserContext {
  mood?: 'good' | 'tired' | 'energetic' | 'stressed' | 'motivated';
  sleep?: 'poor' | 'normal' | 'excellent';
  energy?: number; // 1-10
  availableTime?: number; // minutes
  intensity?: 'low' | 'moderate' | 'high';
  notes?: string; // Free-form user input
}

export interface WorkoutSession {
  id: string;
  userId: string;
  planId: string | null;
  sessionKey: string | null; // e.g., 'upper_a'
  status: SessionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMinutes: number | null;
  userContextJson: UserContext | null;
  // Session plan (LLM recommendation) - stored during session_planning phase
  // Contains: exercises list, reasoning, estimated duration, warnings
  // Can be modified by user before training starts
  sessionPlanJson: SessionRecommendation | null;
  lastActivityAt: Date;
  autoCloseReason: 'timeout' | 'new_session_started' | 'manual' | null;
  createdAt: Date;
  updatedAt: Date;
}

// --- Session Exercise ---

export interface SessionExercise {
  id: string;
  sessionId: string;
  exerciseId: number;
  orderIndex: number;
  status: SessionExerciseStatus;
  targetSets: number | null;
  targetReps: string | null; // e.g., '8-10'
  targetWeight: string | null; // DECIMAL stored as string
  actualRepsRange: string | null; // e.g., '8,8,7' or '10-8'
  userFeedback: string | null;
  createdAt: Date;
}

export interface SessionExerciseWithDetails extends SessionExercise {
  exercise: ExerciseWithMuscles;
  sets: SessionSet[];
}

// --- Session Set ---

// Discriminated union for set_data based on exercise_type
export type StrengthSetData = {
  type: 'strength';
  reps: number;
  weight?: number;
  weightUnit?: 'kg' | 'lbs';
  restSeconds?: number;
};

export type CardioDistanceSetData = {
  type: 'cardio_distance';
  distance: number;
  distanceUnit: 'km' | 'miles' | 'meters';
  duration: number; // seconds
  pace?: number; // min/km or min/mile
  restSeconds?: number;
};

export type CardioDurationSetData = {
  type: 'cardio_duration';
  duration: number; // seconds
  intensity?: 'low' | 'moderate' | 'high';
  restSeconds?: number;
};

export type FunctionalRepsSetData = {
  type: 'functional_reps';
  reps: number;
  restSeconds?: number;
};

export type IsometricSetData = {
  type: 'isometric';
  duration: number; // seconds
  restSeconds?: number;
};

export type IntervalSetData = {
  type: 'interval';
  workDuration: number; // seconds
  restDuration: number; // seconds
  rounds?: number;
};

export type SetData =
  | StrengthSetData
  | CardioDistanceSetData
  | CardioDurationSetData
  | FunctionalRepsSetData
  | IsometricSetData
  | IntervalSetData;

export interface SessionSet {
  id: string;
  sessionExerciseId: string;
  setNumber: number;
  rpe: number | null; // 1-10
  userFeedback: string | null;
  createdAt: Date;
  completedAt: Date | null;
  setData: SetData;
}

// --- Session Recommendation ---

export interface RecommendedExercise {
  exerciseId: number;
  exerciseName: string;
  targetSets: number;
  targetReps: string;
  targetWeight?: number;
  restSeconds: number;
  notes?: string;
  imageUrl?: string;
  videoUrl?: string;
}

export interface SessionRecommendation {
  sessionKey: string;
  sessionName: string;
  reasoning: string;
  exercises: RecommendedExercise[];
  estimatedDuration: number; // minutes - actual plan duration
  timeLimit?: number; // minutes - user's available time (hard constraint)
  warnings?: string[];
  modifications?: string[];
}

// --- DTOs for creation ---

export interface CreateWorkoutPlanDto {
  name: string;
  planJson: WorkoutPlanJson;
  status?: WorkoutPlanStatus;
}

export interface CreateSessionDto {
  planId?: string;
  sessionKey?: string;
  userContext?: UserContext;
  status?: SessionStatus;
  sessionPlanJson?: SessionRecommendation;
}

export interface CreateSessionExerciseDto {
  exerciseId: number;
  orderIndex: number;
  targetSets?: number;
  targetReps?: string;
  targetWeight?: number;
}

export interface CreateSessionSetDto {
  setNumber: number;
  setData: SetData;
  rpe?: number;
  userFeedback?: string;
}

// --- Training History ---

export interface WorkoutSessionWithDetails extends WorkoutSession {
  exercises: SessionExerciseWithDetails[];
}

export interface TrainingHistoryEntry {
  session: WorkoutSession;
  exercises: Array<{
    exercise: Exercise;
    sessionExercise: SessionExercise;
    sets: SessionSet[];
  }>;
}
