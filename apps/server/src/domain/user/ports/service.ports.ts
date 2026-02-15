import { ConversationPhase } from '@domain/conversation/ports/conversation-context.ports';
import { ChatMsg } from '@domain/user/ports';
import { CreateUserInput, ParsedProfileData, User } from '@domain/user/services/user.service';

// DI Tokens for services
export const USER_SERVICE_TOKEN = Symbol('UserService');
export const REGISTRATION_SERVICE_TOKEN = Symbol('RegistrationService');
export const CHAT_SERVICE_TOKEN = Symbol('ChatService');

// Service interfaces - business logic contracts
export interface IUserService {
  upsertUser(data: CreateUserInput): Promise<User>;
  getUser(id: string): Promise<User | null>;
  updateProfileData(id: string, data: Partial<User>): Promise<User | null>;
  isRegistrationComplete(user: User): boolean;
}

export interface IRegistrationService {
  processUserMessage(user: User, message: string, historyMessages?: ChatMsg[]): Promise<{
    updatedUser: User;
    response: string;
    isComplete: boolean;
    parsedData?: ParsedProfileData;
    phaseTransition?: { toPhase: 'chat' | 'plan_creation'; reason?: string };
  }>;
  checkProfileCompleteness(user: User): boolean;
}

export interface IChatService {
  /**
   * Process user message in any conversation phase
   * 
   * @param user - Current user
   * @param message - User message
   * @param phase - Current conversation phase (chat, session_planning, training)
   * @param historyMessages - Conversation history for LLM prompt
   * @returns Assistant response
   */
  processMessage(
    user: User,
    message: string,
    phase: ConversationPhase,
    historyMessages?: ChatMsg[],
  ): Promise<ProcessMessageResult>;
}

export interface ProcessMessageResult {
  message: string;
  /** Phase after processing. Same as input phase if no transition occurred. */
  effectivePhase: ConversationPhase;
  /** Present only when LLM requested a phase transition */
  phaseTransition?: {
    toPhase: ConversationPhase;
    reason?: string;
    sessionId?: string;
  };
}
