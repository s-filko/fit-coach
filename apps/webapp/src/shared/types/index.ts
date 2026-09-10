export interface User {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
  age?: number;
  height?: number;
  weight?: number;
  fitnessGoal?: string;
  fitnessLevel?: string;
  profileStatus?: string;
  timezone?: string;
}

export interface SessionTemplateExercise {
  exerciseId: string;
  exerciseName: string;
  targetSets: number;
  targetReps: string;
  targetWeight?: number;
  restSeconds: number;
  notes?: string;
}

export interface SessionTemplate {
  key: string;
  name: string;
  focus: string;
  estimatedDuration: number;
  exercises: SessionTemplateExercise[];
}

export interface WorkoutPlanJson {
  goal: string;
  trainingStyle: string;
  targetMuscleGroups: string[];
  sessionTemplates: SessionTemplate[];
  progressionRules: string[];
}

export interface WorkoutPlan {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  planJson: WorkoutPlanJson;
  createdAt: string;
}

export interface WorkoutSession {
  id: string;
  planId?: string;
  sessionKey?: string;
  status: 'planning' | 'in_progress' | 'completed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  durationMinutes?: number;
  sessionPlanJson?: SessionRecommendation | null;
  exercises: SessionExercise[];
}

export interface SessionExercise {
  id: string;
  exerciseId: string;
  orderIndex: number;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  targetSets?: number;
  targetReps?: string;
  targetWeight?: string;
  sets: SessionSet[];
}

export interface SessionSet {
  id: string;
  setNumber: number;
  rpe?: number;
  setData: Record<string, unknown>;
  completedAt?: string;
}

export interface RecommendedExercise {
  exerciseId: string;
  exerciseName?: string;
  targetSets: number;
  targetReps: string;
  targetWeight?: number;
  restSeconds: number;
  notes?: string;
}

export interface SessionRecommendation {
  sessionKey: string;
  sessionName: string;
  reasoning: string;
  exercises: RecommendedExercise[];
  estimatedDuration: number;
  warnings?: string[];
  modifications?: string[];
}

export interface Exercise {
  id: string;
  name: string;
  category: string;
  equipment: string;
  exerciseType: string;
  description?: string;
  muscleGroups: MuscleGroupLink[];
}

export interface MuscleGroupLink {
  muscleGroup: string;
  involvement: string;
}
