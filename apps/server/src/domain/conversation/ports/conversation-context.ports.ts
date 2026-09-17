import { ChatMsg } from '@domain/ai/types';

import type { ConversationPhase } from '../phases';

export type { ConversationPhase };

export interface GetMessagesOptions {
  maxTurns?: number;
}

export const CONVERSATION_CONTEXT_SERVICE_TOKEN = Symbol('ConversationContextService');

export interface IConversationContextService {
  appendTurn(userId: string, phase: ConversationPhase, userContent: string, assistantContent: string): Promise<void>;
  getMessagesForPrompt(userId: string, phase: ConversationPhase, options?: GetMessagesOptions): Promise<ChatMsg[]>;
  insertContextReset(userId: string): Promise<void>;
  insertPhaseSummary(userId: string, phase: ConversationPhase, summary: string): Promise<void>;
  getLatestSummary(userId: string): Promise<string | null>;
  getLastUserMessageTime(userId: string): Promise<Date | null>;
}
