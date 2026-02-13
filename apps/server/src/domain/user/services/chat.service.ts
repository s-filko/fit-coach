import { LLMService } from '@domain/ai/ports';
import { parseLLMResponse } from '@domain/conversation/llm-response.types';
import { ConversationPhase, type IConversationContextService } from '@domain/conversation/ports/conversation-context.ports';
import type { ITrainingService } from '@domain/training/ports';
import { SessionPlanningContextBuilder } from '@domain/training/services/session-planning-context.builder';
import type { SessionRecommendation } from '@domain/training/types';
import {
  ChatMsg,
  IChatService,
  IPromptService,
  type SessionPlanningPromptContext,
  type TrainingPromptContext,
} from '@domain/user/ports';

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
    private readonly trainingService: ITrainingService,
    private readonly sessionPlanningContextBuilder: SessionPlanningContextBuilder,
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
      
      case 'session_planning': {
        const context = await this.loadSessionPlanningContext(user);
        return this.promptService.buildSessionPlanningPrompt(context);
      }
      
      case 'training': {
        const context = await this.loadTrainingContext(user);
        return this.promptService.buildTrainingPrompt(context);
      }
      
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
   * Load context data for session planning prompt
   * Includes training history, active plan, and recovery timeline
   */
  private async loadSessionPlanningContext(user: User): Promise<SessionPlanningPromptContext> {
    // Use SessionPlanningContextBuilder to load all required data
    const contextData = await this.sessionPlanningContextBuilder.buildContext(user.id);

    // Get current plan from conversation context if exists
    const conversationCtx = await this.conversationContextService.getContext(user.id, 'session_planning');
    let currentPlan: SessionRecommendation | null = null;

    if (conversationCtx?.phase === 'session_planning' && conversationCtx.sessionPlanningContext?.recommendedSessionId) {
      const session = await this.trainingService.getSessionDetails(
        conversationCtx.sessionPlanningContext.recommendedSessionId,
      );
      currentPlan = session?.sessionPlanJson ?? null;
    }

    return {
      user,
      activePlan: contextData.activePlan,
      recentSessions: contextData.recentSessions,
      currentPlan,
      totalExercisesAvailable: contextData.totalExercisesAvailable,
      daysSinceLastWorkout: contextData.daysSinceLastWorkout,
    };
  }

  /**
   * Load context data for training prompt
   * Includes active session with all exercises and sets
   */
  private async loadTrainingContext(user: User): Promise<TrainingPromptContext> {
    // Get active session ID from conversation context
    const conversationCtx = await this.conversationContextService.getContext(user.id, 'training');

    if (conversationCtx?.phase !== 'training' || !conversationCtx.trainingContext?.activeSessionId) {
      throw new Error('No active training session found in conversation context');
    }

    // Load full session details from DB
    const activeSession = await this.trainingService.getSessionDetails(
      conversationCtx.trainingContext.activeSessionId,
    );

    if (!activeSession) {
      throw new Error(`Active session ${conversationCtx.trainingContext.activeSessionId} not found in database`);
    }

    return {
      user,
      activeSession,
    };
  }

  /**
   * Execute phase transition requested by LLM
   * 
   * Validates the transition before executing it to ensure data consistency.
   * LLM decides when to transition, but code validates the decision.
   * 
   * @param userId - User ID
   * @param fromPhase - Current phase
   * @param toPhase - Target phase
   * @param reason - Optional reason for transition (for logging)
   * @param sessionId - Optional session ID (for training phase)
   * @throws {Error} if transition is invalid or data is inconsistent
   */
  private async executePhaseTransition(
    userId: string,
    fromPhase: ConversationPhase,
    toPhase: ConversationPhase,
    reason?: string,
    sessionId?: string,
  ): Promise<void> {
    // Validate transition before executing
    await this.validatePhaseTransition(userId, fromPhase, toPhase, sessionId);

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
   * Validate phase transition
   * 
   * LLM can request a transition, but code must validate it to ensure:
   * - Required data exists (e.g., workout plan, session)
   * - No conflicting state (e.g., already active session)
   * - Logical flow (e.g., can't go from training to planning without completing)
   * 
   * @throws {Error} if transition is invalid
   */
  private async validatePhaseTransition(
    userId: string,
    fromPhase: ConversationPhase,
    toPhase: ConversationPhase,
    sessionId?: string,
  ): Promise<void> {
    // chat → session_planning: always allowed
    if (fromPhase === 'chat' && toPhase === 'session_planning') {
      return;
    }

    // session_planning → training: validate session exists and user has plan
    if (fromPhase === 'session_planning' && toPhase === 'training') {
      if (!sessionId) {
        throw new Error('Cannot start training: sessionId is required');
      }

      // TODO: Validate session exists and belongs to user
      // TODO: Validate user has active workout plan
      // TODO: Validate no other active session exists
      // Will be implemented when TrainingService is integrated
      return;
    }

    // training → chat: always allowed (auto-complete session)
    if (fromPhase === 'training' && toPhase === 'chat') {
      // TODO: Auto-complete the active session if not already completed
      // Will be implemented in Step 7
      return;
    }

    // session_planning → chat: always allowed (cancel planning)
    if (fromPhase === 'session_planning' && toPhase === 'chat') {
      // TODO: Clean up draft recommendation if exists
      return;
    }

    // training → session_planning: block this transition
    if (fromPhase === 'training' && toPhase === 'session_planning') {
      throw new Error('Cannot return to planning from active training. Complete or cancel training first.');
    }

    // Any other transition to/from registration: block
    if (fromPhase === 'registration' || toPhase === 'registration') {
      throw new Error('Registration phase transitions are handled separately');
    }

    // Unknown transition
    throw new Error(`Invalid phase transition: ${fromPhase} → ${toPhase}`);
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
