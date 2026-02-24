import type {
  Exercise,
  SessionRecommendation,
  WorkoutPlan,
  WorkoutSessionWithDetails,
} from '@domain/training/types';
import { User } from '@domain/user/services/user.service';

// Chat message interface for LLM interactions
export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Context for plan creation prompt
export interface PlanCreationPromptContext {
  user: User;
  availableExercises: Exercise[];
  totalExercisesAvailable: number;
}

// Context for session planning prompt
export interface SessionPlanningPromptContext {
  user: User;
  activePlan: WorkoutPlan | null;
  recentSessions: WorkoutSessionWithDetails[];
  currentPlan: SessionRecommendation | null;
  totalExercisesAvailable: number;
  daysSinceLastWorkout: number | null;
  availableExercises: Array<{ id: number; name: string; category: string }>;
}

// Context for training prompt
export interface TrainingPromptContext {
  user: User;
  activeSession: WorkoutSessionWithDetails;
  availableExercises: Array<{ id: number; name: string; category: string }>;
}

// DI Token for prompt service
export const PROMPT_SERVICE_TOKEN = Symbol('PromptService');

// Prompt service interface - specialized for prompt generation
export interface IPromptService {
  // TODO: remove — registration prompt lives in infra/ai/graph/nodes/registration.node.ts
  buildUnifiedRegistrationPrompt(user: User): string;
  // TODO: remove — chat prompt lives in infra/ai/graph/nodes/chat.node.ts
  buildChatSystemPrompt(user: User, hasActivePlan: boolean, recentSessions?: WorkoutSessionWithDetails[]): string;
  /** System prompt for plan creation phase */
  buildPlanCreationPrompt(context: PlanCreationPromptContext): string;
  /** System prompt for session planning phase */
  buildSessionPlanningPrompt(context: SessionPlanningPromptContext): string;
  /** System prompt for training phase */
  buildTrainingPrompt(context: TrainingPromptContext): string;
}
