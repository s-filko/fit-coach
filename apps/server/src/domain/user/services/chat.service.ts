import { LLMService } from '@domain/ai/ports';
import { parseLLMResponse } from '@domain/conversation/llm-response.types';
import { ConversationPhase, type IConversationContextService } from '@domain/conversation/ports/conversation-context.ports';
import { ChatMsg, IChatService, IPromptService } from '@domain/user/ports';

import { User } from './user.service';

/**
 * ChatService - the "brain" of the application
 * 
 * Responsibilities:
 * - Determines current conversation phase
 * - Routes requests to appropriate handlers based on phase
 * - Parses LLM responses with phaseTransition flags
 * - Executes phase transitions via ConversationContextService
 * 
 * Phase flow:
 * - chat → session_planning (user wants to plan workout)
 * - session_planning → training (plan accepted, training starts)
 * - training → chat (training completed)
 * - any phase → chat (user changes mind)
 */
export class ChatService implements IChatService {
  constructor(
    private readonly promptService: IPromptService,
    private readonly llmService: LLMService,
    private readonly conversationContextService: IConversationContextService,
  ) {}

  /**
   * Process user message in any phase (chat, session_planning, training)
   * 
   * @param user - Current user
   * @param message - User message
   * @param phase - Current conversation phase
   * @param historyMessages - Conversation history for prompt
   * @returns Assistant response
   */
  async processMessage(
    user: User,
    message: string,
    phase: ConversationPhase,
    historyMessages: ChatMsg[] = [],
  ): Promise<string> {
    // 1. Build phase-specific system prompt
    const systemPrompt = await this.buildSystemPrompt(user, phase);

    // 2. Prepare messages for LLM
    const messages: ChatMsg[] = [
      ...historyMessages,
      { role: 'user', content: message },
    ];

    // 3. Call LLM with JSON mode for structured response
    const llmResponse = await this.llmService.generateWithSystemPrompt(
      messages,
      systemPrompt,
      { jsonMode: true },
    );

    // 4. Parse LLM response (includes phaseTransition flag)
    const parsed = parseLLMResponse(llmResponse);

    // 5. Execute phase transition if requested by LLM
    if (parsed.phaseTransition) {
      await this.executePhaseTransition(
        user.id,
        phase,
        parsed.phaseTransition.toPhase,
        parsed.phaseTransition.reason,
        parsed.phaseTransition.sessionId,
      );
    }

    // 6. Return message to user
    return parsed.message;
  }

  /**
   * Build system prompt based on current phase
   * 
   * For session_planning: includes training history, active plan, recovery data
   * For training: includes current session state, exercise details, progress
   * For chat: standard chat prompt
   */
  private async buildSystemPrompt(user: User, phase: ConversationPhase): Promise<string> {
    switch (phase) {
      case 'chat':
        return this.promptService.buildChatSystemPrompt(user);
      
      case 'session_planning':
        // TODO: Build session planning prompt with context
        // Will be implemented in Step 6
        return this.promptService.buildChatSystemPrompt(user);
      
      case 'training':
        // TODO: Build training prompt with active session context
        // Will be implemented in Step 6
        return this.promptService.buildChatSystemPrompt(user);
      
      case 'registration':
        // Registration is handled by RegistrationService
        throw new Error('Registration phase should be handled by RegistrationService');
      
      default: {
        // Exhaustive check
        const _exhaustive: never = phase;
        throw new Error(`Unknown phase: ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * Execute phase transition requested by LLM
   * 
   * @param userId - User ID
   * @param fromPhase - Current phase
   * @param toPhase - Target phase
   * @param reason - Optional reason for transition (for logging)
   * @param sessionId - Optional session ID (for training phase)
   */
  private async executePhaseTransition(
    userId: string,
    fromPhase: ConversationPhase,
    toPhase: ConversationPhase,
    reason?: string,
    sessionId?: string,
  ): Promise<void> {
    // Build system note for the new phase
    const systemNote = this.buildPhaseTransitionNote(fromPhase, toPhase, reason);

    // Prepare phase-specific context
    const options: Parameters<typeof this.conversationContextService.startNewPhase>[4] = {};

    if (toPhase === 'training' && sessionId) {
      options.trainingContext = { activeSessionId: sessionId };
    }

    // Execute transition
    await this.conversationContextService.startNewPhase(
      userId,
      fromPhase,
      toPhase,
      systemNote,
      options,
    );
  }

  /**
   * Build system note for phase transition
   */
  private buildPhaseTransitionNote(
    fromPhase: ConversationPhase,
    toPhase: ConversationPhase,
    reason?: string,
  ): string {
    const transitions: Record<string, string> = {
      'chat->session_planning': 'Starting workout planning session',
      'session_planning->training': 'Starting training session',
      'training->chat': 'Training session completed',
      'session_planning->chat': 'Workout planning cancelled',
      'training->session_planning': 'Returning to workout planning',
    };

    const key = `${fromPhase}->${toPhase}`;
    const defaultNote = `Phase transition: ${fromPhase} → ${toPhase}`;
    const note = transitions[key] ?? defaultNote;

    return reason ? `${note} (${reason})` : note;
  }
}
