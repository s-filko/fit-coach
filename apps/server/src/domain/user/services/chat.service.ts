import { LLMService } from '@domain/ai/ports';
import { parseLLMResponse } from '@domain/conversation/llm-response.types';
import { ConversationPhase, type IConversationContextService } from '@domain/conversation/ports/conversation-context.ports';
import type { ITrainingService } from '@domain/training/ports';
import { SessionPlanningContextBuilder } from '@domain/training/services/session-planning-context.builder';
import {
  parseTrainingResponse,
  type TrainingIntent,
} from '@domain/training/training-intent.types';
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

    // 4. Parse LLM response based on phase
    let parsedMessage: string;
    let phaseTransition: { toPhase: ConversationPhase; reason?: string; sessionId?: string } | undefined;

    if (phase === 'training') {
      // Training phase: parse training response with intent
      const trainingResponse = parseTrainingResponse(llmResponse);
      parsedMessage = trainingResponse.message;
      
      // Execute training intent if present
      if (trainingResponse.intent) {
        await this.executeTrainingIntent(user.id, trainingResponse.intent);
      }

      // Map phase transition if present
      if (trainingResponse.phaseTransition) {
        phaseTransition = {
          toPhase: trainingResponse.phaseTransition.toPhase,
          reason: trainingResponse.phaseTransition.reason,
        };
      }
    } else {
      // Other phases: use standard LLM response parser
      const { message, phaseTransition: transition } = parseLLMResponse(llmResponse);
      parsedMessage = message;
      phaseTransition = transition;
    }

    // 5. Execute phase transition if requested by LLM
    if (phaseTransition) {
      await this.executePhaseTransition(
        user.id,
        phase,
        phaseTransition.toPhase,
        phaseTransition.reason,
        phaseTransition.sessionId,
      );
    }

    // 6. Return message to user
    return parsedMessage;
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
   * Execute training intent extracted from LLM response
   * Routes to appropriate TrainingService methods based on intent type
   */
  private async executeTrainingIntent(userId: string, intent: TrainingIntent): Promise<void> {
    // Get active session ID from conversation context
    const conversationCtx = await this.conversationContextService.getContext(userId, 'training');
    if (conversationCtx?.phase !== 'training' || !conversationCtx.trainingContext?.activeSessionId) {
      throw new Error('No active training session found');
    }

    const sessionId = conversationCtx.trainingContext.activeSessionId;

    // Route based on intent type
    switch (intent.type) {
      case 'log_set': {
        // Find current in_progress exercise
        const session = await this.trainingService.getSessionDetails(sessionId);
        if (!session) {
          throw new Error('Session not found');
        }

        const currentExercise = session.exercises.find((ex) => ex.status === 'in_progress');
        if (!currentExercise) {
          throw new Error('No exercise currently in progress');
        }

        // Calculate next set number
        const nextSetNumber = currentExercise.sets.length + 1;

        // Log the set
        await this.trainingService.logSet(currentExercise.id, {
          setNumber: nextSetNumber,
          setData: intent.setData,
          rpe: intent.rpe,
          userFeedback: intent.feedback,
        });
        break;
      }

      case 'next_exercise': {
        // Complete current exercise and start next
        await this.trainingService.completeCurrentExercise(sessionId);
        await this.trainingService.startNextExercise(sessionId);
        break;
      }

      case 'skip_exercise': {
        // Skip current exercise
        await this.trainingService.skipCurrentExercise(sessionId);
        break;
      }

      case 'finish_training': {
        // Complete the session
        await this.trainingService.completeSession(sessionId);
        break;
      }

      case 'request_advice':
      case 'modify_session':
      case 'just_chat': {
        // These intents don't require database actions
        // LLM handles them conversationally
        break;
      }

      default: {
        // Exhaustive check
        const _exhaustive: never = intent;
        throw new Error(`Unknown training intent type: ${JSON.stringify(_exhaustive)}`);
      }
    }
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
    // registration → session_planning: always allowed (happens after registration complete)
    if (fromPhase === 'registration' && toPhase === 'session_planning') {
      return;
    }

    // registration → chat: always allowed (user wants to chat first)
    if (fromPhase === 'registration' && toPhase === 'chat') {
      return;
    }

    // chat → session_planning: always allowed
    if (fromPhase === 'chat' && toPhase === 'session_planning') {
      return;
    }

    // session_planning → training: validate session exists and user has plan
    if (fromPhase === 'session_planning' && toPhase === 'training') {
      if (!sessionId) {
        throw new Error('Cannot start training: sessionId is required');
      }

      // Validate session exists and belongs to user
      const session = await this.trainingService.getSessionDetails(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      if (session.userId !== userId) {
        throw new Error(`Session ${sessionId} does not belong to user ${userId}`);
      }

      // Validate session is in planning status (not already started/completed)
      if (session.status !== 'planning') {
        throw new Error(`Cannot start training: session is already ${session.status}`);
      }

      // Validate no other active session exists
      const activeSession = await this.conversationContextService.getContext(userId, 'training');
      if (activeSession?.phase === 'training' && activeSession.trainingContext?.activeSessionId) {
        const existingSession = await this.trainingService.getSessionDetails(
          activeSession.trainingContext.activeSessionId,
        );
        if (existingSession && existingSession.status === 'in_progress') {
          throw new Error('Cannot start new training: another session is already in progress');
        }
      }

      return;
    }

    // training → chat: auto-complete the active session if not already completed
    if (fromPhase === 'training' && toPhase === 'chat') {
      // Get active session from conversation context
      const conversationCtx = await this.conversationContextService.getContext(userId, 'training');
      if (conversationCtx?.phase === 'training' && conversationCtx.trainingContext?.activeSessionId) {
        const session = await this.trainingService.getSessionDetails(
          conversationCtx.trainingContext.activeSessionId,
        );
        
        // Auto-complete if still in progress
        if (session && session.status === 'in_progress') {
          await this.trainingService.completeSession(session.id);
        }
      }
      return;
    }

    // session_planning → chat: clean up draft recommendation if exists
    if (fromPhase === 'session_planning' && toPhase === 'chat') {
      // Get planning context
      const conversationCtx = await this.conversationContextService.getContext(userId, 'session_planning');
      if (conversationCtx?.phase === 'session_planning' && conversationCtx.sessionPlanningContext?.recommendedSessionId) {
        const session = await this.trainingService.getSessionDetails(
          conversationCtx.sessionPlanningContext.recommendedSessionId,
        );
        
        // If session is still in planning status (not started), mark it as skipped
        if (session && session.status === 'planning') {
          await this.trainingService.completeSession(session.id);
        }
      }
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
