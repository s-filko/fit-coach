import { ChatMsg } from '@domain/user/ports';

// --- Types ---

export type ConversationPhase = 'registration' | 'chat' | 'plan_creation' | 'session_planning' | 'training';

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system' | 'summary';
  content: string;
  timestamp: Date;
}

// Phase-specific context data
export interface PlanCreationContext {
  // Stores the draft plan while user reviews/modifies it
  draftPlanId?: string; // Optional: if we pre-create a draft plan
}

export interface SessionPlanningContext {
  // Stores the recommended session while user reviews/modifies it
  recommendedSessionId?: string; // Optional: if we pre-create a draft session
  // Cached session plan from LLM response (for reliability when transitioning to training)
  // Runtime type: SessionRecommendation (from session-planning.types.ts)
  // Stored as Record to avoid circular import (session-planning.types → this file)
  lastSessionPlan?: Record<string, unknown>;
}

export interface TrainingContext {
  // Active workout session ID
  activeSessionId: string;
}

// Base context structure
interface BaseConversationContext {
  userId: string;
  turns: ConversationTurn[];
  summarySoFar?: string;
  lastActivityAt?: Date;
}

// Phase-specific context variants
export type ConversationContext =
  | (BaseConversationContext & { phase: 'registration' })
  | (BaseConversationContext & { phase: 'chat' })
  | (BaseConversationContext & { phase: 'plan_creation'; planCreationContext?: PlanCreationContext })
  | (BaseConversationContext & { phase: 'session_planning'; sessionPlanningContext?: SessionPlanningContext })
  | (BaseConversationContext & { phase: 'training'; trainingContext: TrainingContext });

export interface GetMessagesOptions {
  maxTurns?: number;
}

export interface ResetOptions {
  reason?: string;
}

export interface StartNewPhaseOptions {
  preserveSummary?: boolean;
  // Phase-specific context to initialize
  planCreationContext?: PlanCreationContext;
  sessionPlanningContext?: SessionPlanningContext;
  trainingContext?: TrainingContext;
}

// --- DI Token ---

export const CONVERSATION_CONTEXT_SERVICE_TOKEN = Symbol('ConversationContextService');

// --- Port Interface [BR-CONV-001..BR-CONV-007] ---

export interface IConversationContextService {
  getContext(userId: string, phase: ConversationPhase): Promise<ConversationContext | null>;
  appendTurn(userId: string, phase: ConversationPhase, userContent: string, assistantContent: string): Promise<void>;
  getMessagesForPrompt(ctx: ConversationContext, options?: GetMessagesOptions): ChatMsg[];
  reset(userId: string, phase: ConversationPhase, options?: ResetOptions): Promise<void>;
  summarize(userId: string, phase: ConversationPhase): Promise<void>;
  startNewPhase(
    userId: string, fromPhase: ConversationPhase, toPhase: ConversationPhase,
    systemNote: string, options?: StartNewPhaseOptions,
  ): Promise<void>;
  /** Update phase-specific context (e.g., cache session plan) */
  updatePhaseContext(
    userId: string,
    phase: ConversationPhase,
    context: SessionPlanningContext | TrainingContext,
  ): Promise<void>;
}
