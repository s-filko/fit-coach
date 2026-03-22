import { ChatMsg } from '@domain/user/ports';

export type ConversationPhase = 'registration' | 'chat' | 'plan_creation' | 'session_planning' | 'training';

export interface GetMessagesOptions {
  maxTurns?: number;
}

export const CONVERSATION_CONTEXT_SERVICE_TOKEN = Symbol('ConversationContextService');

export interface IConversationContextService {
  appendTurn(userId: string, phase: ConversationPhase, userContent: string, assistantContent: string): Promise<void>;
  getMessagesForPrompt(userId: string, phase: ConversationPhase, options?: GetMessagesOptions): Promise<ChatMsg[]>;
  insertContextReset(userId: string): Promise<void>;
}
