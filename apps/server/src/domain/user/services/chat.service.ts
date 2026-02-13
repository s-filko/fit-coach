import { LLMService } from '@domain/ai/ports';
import { parseLLMResponse } from '@domain/conversation/llm-response.types';
import {
  ConversationPhase,
  type IConversationContextService,
} from '@domain/conversation/ports/conversation-context.ports';
import { parsePlanCreationResponse, type WorkoutPlanDraft } from '@domain/training/plan-creation.types';
import type { IExerciseRepository, ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import { SessionPlanningContextBuilder } from '@domain/training/services/session-planning-context.builder';
import { parseSessionPlanningResponse } from '@domain/training/session-planning.types';
import { parseTrainingResponse, type TrainingIntent } from '@domain/training/training-intent.types';
import type { SessionRecommendation, WorkoutSession } from '@domain/training/types';
import {
  ChatMsg,
  IChatService,
  IPromptService,
  type PlanCreationPromptContext,
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
 * - chat → plan_creation (user wants to create workout plan)
 * - plan_creation → session_planning (plan created, ready to plan sessions)
 * - session_planning → training (session planned, training starts)
 * - training → chat (training completed)
 * - any phase → chat (user changes mind)
 */
export class ChatService implements IChatService {
  constructor(
    private readonly promptService: IPromptService,
    private readonly llmService: LLMService,
    private readonly conversationContextService: IConversationContextService,
    private readonly trainingService: ITrainingService,
    private readonly workoutPlanRepo: IWorkoutPlanRepository,
    private readonly exerciseRepo: IExerciseRepository,
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
    let sessionPlan: SessionRecommendation | undefined;
    let workoutPlan: WorkoutPlanDraft | undefined;

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
    } else if (phase === 'plan_creation') {
      // Plan creation phase: parse plan creation response with optional workout plan
      const planCreationResponse = parsePlanCreationResponse(llmResponse);
      const { message: msg, workoutPlan: plan, phaseTransition: transition } = planCreationResponse;
      parsedMessage = msg;
      workoutPlan = plan;
      phaseTransition = transition;

      // Save workout plan ONLY if transitioning to session_planning (user approved)
      // Plan is kept in conversation history until user approves
      // If user cancels, no plan is created - draft is just lost with conversation context
      if (workoutPlan && phaseTransition?.toPhase === 'session_planning') {
        await this.saveWorkoutPlan(user.id, workoutPlan);
      }
    } else if (phase === 'session_planning') {
      // Session planning phase: parse session planning response with optional plan
      const planningResponse = parseSessionPlanningResponse(llmResponse);
      const { message: msg, sessionPlan: plan, phaseTransition: transition } = planningResponse;
      parsedMessage = msg;
      sessionPlan = plan;
      phaseTransition = transition;

      // Save session plan ONLY if transitioning to training (user confirmed)
      // Plans are kept in conversation history until user confirms
      // If user cancels, no session is created - plan is just lost with conversation context
      if (sessionPlan && phaseTransition?.toPhase === 'training') {
        const session = await this.saveSessionPlan(user.id, sessionPlan);
        // Update phase transition with session ID for training phase
        phaseTransition.sessionId = session.id;
      }
    } else {
      // Other phases (chat, registration): use standard LLM response parser
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
   * For plan_creation: includes user profile and available exercises
   * For session_planning: includes training history, active plan, recovery data
   * For training: includes current session state, exercise details, progress
   * For chat: standard chat prompt
   */
  private async buildSystemPrompt(user: User, phase: ConversationPhase): Promise<string> {
    switch (phase) {
      case 'chat': {
        const activePlan = await this.workoutPlanRepo.findActiveByUserId(user.id);
        return this.promptService.buildChatSystemPrompt(user, !!activePlan);
      }
      
      case 'plan_creation': {
        const context = await this.loadPlanCreationContext(user);
        return this.promptService.buildPlanCreationPrompt(context);
      }
      
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
  /**
   * Load context for plan_creation phase
   * Includes user profile and available exercises
   */
  private async loadPlanCreationContext(user: User): Promise<PlanCreationPromptContext> {
    const exercises = await this.exerciseRepo.findAll();

    return {
      user,
      availableExercises: exercises,
      totalExercisesAvailable: exercises.length,
    };
  }

  /**
   * Load context for session_planning phase
   * Includes training history, active plan, and recovery data
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
   * Save session plan to database
   * Creates a session ready to start training
   * Called ONLY when user confirms they want to start training
   * 
   * @param userId - User ID
   * @param plan - Session recommendation from LLM
   * @returns Created workout session
   */
  /**
   * Save workout plan to database
   * Called when user approves the plan during plan_creation phase
   */
  private async saveWorkoutPlan(userId: string, plan: WorkoutPlanDraft): Promise<void> {
    await this.workoutPlanRepo.create(userId, {
      name: plan.name,
      planJson: {
        goal: plan.goal,
        trainingStyle: plan.trainingStyle,
        targetMuscleGroups: plan.targetMuscleGroups,
        recoveryGuidelines: plan.recoveryGuidelines,
        sessionTemplates: plan.sessionTemplates,
        progressionRules: plan.progressionRules,
      },
      status: 'active',
    });
  }

  /**
   * Save session plan to database
   * Called when user confirms they want to start training
   */
  private async saveSessionPlan(userId: string, plan: SessionRecommendation): Promise<WorkoutSession> {
    // Create session that's ready to start
    // Status will be set to 'in_progress' by startSession (default behavior)
    const session = await this.trainingService.startSession(userId, {
      sessionKey: plan.sessionKey,
      sessionPlanJson: plan,
      // Don't set status: 'planning' - let it start immediately
    });

    return session;
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
    // registration → plan_creation: always allowed (user needs to create workout plan)
    if (fromPhase === 'registration' && toPhase === 'plan_creation') {
      return;
    }

    // registration → chat: always allowed (user wants to chat first)
    if (fromPhase === 'registration' && toPhase === 'chat') {
      return;
    }

    // chat → plan_creation: always allowed (user wants to create workout plan)
    if (fromPhase === 'chat' && toPhase === 'plan_creation') {
      return;
    }

    // plan_creation → session_planning: validate user has active plan
    if (fromPhase === 'plan_creation' && toPhase === 'session_planning') {
      // Plan should have been created by saveWorkoutPlan before this transition
      const activePlan = await this.workoutPlanRepo.findActiveByUserId(userId);
      if (!activePlan) {
        throw new Error('Cannot proceed to session planning: no active workout plan found');
      }
      return;
    }

    // plan_creation → chat: user cancelled plan creation
    if (fromPhase === 'plan_creation' && toPhase === 'chat') {
      return;
    }

    // chat → session_planning: validate user has active plan
    if (fromPhase === 'chat' && toPhase === 'session_planning') {
      const activePlan = await this.workoutPlanRepo.findActiveByUserId(userId);
      if (!activePlan) {
        throw new Error('Cannot plan session: no active workout plan. Create a plan first.');
      }
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

    // session_planning → chat: user cancelled planning
    // No cleanup needed - session is only created when user confirms training start
    if (fromPhase === 'session_planning' && toPhase === 'chat') {
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
      'registration->plan_creation': 'Starting workout plan creation',
      'chat->plan_creation': 'Starting workout plan creation',
      'plan_creation->session_planning': 'Workout plan created, ready for session planning',
      'plan_creation->chat': 'Plan creation cancelled',
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
