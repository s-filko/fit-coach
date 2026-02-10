import { ChatMsg } from '@domain/user/ports';

// --- Types ---

export type ConversationPhase = 'registration' | 'chat' | 'training';

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system' | 'summary';
  content: string;
  timestamp: Date;
}

export interface ConversationContext {
  userId: string;
  phase: ConversationPhase;
  turns: ConversationTurn[];
  summarySoFar?: string;
  lastActivityAt?: Date;
}

export interface GetMessagesOptions {
  maxTurns?: number;
}

export interface ResetOptions {
  reason?: string;
}

export interface StartNewPhaseOptions {
  preserveSummary?: boolean;
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
}
