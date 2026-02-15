import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const chatMessageBody = z.object({
  userId: z.string().min(1).describe('User ID'),
  message: z.string().min(1).describe('User message'),
}).describe('Chat message payload');

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/chat', {
    schema: {
      summary: 'Send chat message to AI',
      body: chatMessageBody,
      security: [{ ApiKeyAuth: [] }],
      response: {
        200: z.object({
          data: z.object({
            content: z.string(),
            timestamp: z.string(),
            registrationComplete: z.boolean().optional(),
          }),
        }),
        400: z.object({ error: z.object({ message: z.string() }) }),
        401: z.object({ error: z.object({ message: z.string() }) }),
        403: z.object({ error: z.object({ message: z.string() }) }),
        404: z.object({ error: z.object({ message: z.string() }) }),
        500: z.object({ error: z.object({ message: z.string(), details: z.string().optional() }) }),
      },
    },
  }, async(req, reply) => {
    try {
      const { userId, message } = req.body as { userId: string; message: string };
      const { conversationContextService } = app.services;

      // 1. Get user data
      const user = await app.services.userService.getUser(userId);
      if (!user) {
        return reply.code(404).send({
          error: { message: 'User not found' },
        });
      }

      // 2. Determine current conversation phase
      const isComplete = app.services.userService.isRegistrationComplete(user);
      
      // If registration not complete, use registration phase
      if (!isComplete) {
        const phase = 'registration' as const;
        
        // Load conversation context and build history
        const ctx = await conversationContextService.getContext(userId, phase);
        const historyMessages = ctx
          ? conversationContextService.getMessagesForPrompt(ctx)
          : [];

        // Create enriched logger with userId
        const log = req.log.child({ userId, phase });

        // Process registration
        const result = await app.services.registrationService.processUserMessage(
          user, message, historyMessages, { log },
        );
        const { response, updatedUser, phaseTransition } = result;

        // Save user profile changes
        await app.services.userService.updateProfileData(userId, {
          profileStatus: updatedUser.profileStatus,
          age: updatedUser.age,
          gender: updatedUser.gender,
          height: updatedUser.height,
          weight: updatedUser.weight,
          fitnessLevel: updatedUser.fitnessLevel,
          fitnessGoal: updatedUser.fitnessGoal,
        });

        // Persist conversation turn
        try {
          await conversationContextService.appendTurn(userId, phase, message, response);
        } catch (err) {
          req.log.warn({ err }, 'Failed to append conversation turn — response not affected');
        }

        // Phase transition: registration → chat/plan_creation
        const nowComplete = app.services.userService.isRegistrationComplete(updatedUser);
        if (nowComplete) {
          try {
            // Use LLM's decision if provided, otherwise default to plan_creation
            const targetPhase: 'chat' | 'plan_creation' = phaseTransition?.toPhase ?? 'plan_creation';
            const transitionNote = targetPhase === 'plan_creation'
              ? 'Registration complete. Let\'s create your workout plan!'
              : 'Registration complete. Ready to chat!';
            
            await conversationContextService.startNewPhase(
              userId, 'registration', targetPhase, transitionNote,
            );
            
            req.log.info({ userId, targetPhase }, 'Phase transition after registration complete');
          } catch (err) {
            req.log.error({ err, userId }, 'Failed to transition conversation phase after registration');
            // This is critical - if transition fails, user will be stuck
            throw new Error('Failed to complete registration phase transition');
          }
        }

        return reply.send({
          data: {
            content: response,
            timestamp: new Date().toISOString(),
            registrationComplete: nowComplete,
          },
        });
      }

      // Registration complete - determine phase from existing contexts
      // Priority: training > session_planning > plan_creation > chat
      let phase: 'chat' | 'plan_creation' | 'session_planning' | 'training' = 'chat';
      
      const trainingCtx = await conversationContextService.getContext(userId, 'training');
      const planningCtx = await conversationContextService.getContext(userId, 'session_planning');
      const planCreationCtx = await conversationContextService.getContext(userId, 'plan_creation');
      
      if (trainingCtx) {
        phase = 'training';
      } else if (planningCtx) {
        phase = 'session_planning';
      } else if (planCreationCtx) {
        phase = 'plan_creation';
      }

      req.log.info({ 
        userId, 
        phase, 
        hasTrainingCtx: !!trainingCtx, 
        hasPlanningCtx: !!planningCtx, 
        hasPlanCreationCtx: !!planCreationCtx,
      }, 'Determined conversation phase');

      // Load conversation context and build history [BR-CONV-001, BR-CONV-003]
      const ctx = await conversationContextService.getContext(userId, phase);
      const historyMessages = ctx
        ? conversationContextService.getMessagesForPrompt(ctx)
        : [];

      // Create enriched logger with userId and phase
      const log = req.log.child({ userId, phase });

      // Process message via ChatService (returns message + optional phase transition)
      const result = await app.services.chatService.processMessage(
        user, message, phase, historyMessages, { log },
      );
      const { message: response, phaseTransition } = result;

      // ADR-0005 flow: "call LLM -> appendTurn -> on phase change call startNewPhase"
      // CRITICAL: If phase transition occurs, startNewPhase DELETES old phase turns.
      // So we must save the turn in the NEW phase, not the old one.
      
      // 1. Validate phase transition BEFORE saving turn
      let effectivePhase: typeof phase = phase;
      if (phaseTransition) {
        const { toPhase } = phaseTransition;
        
        // Validation: Ignore transition to the same phase (LLM error)
        if (toPhase === phase) {
          req.log.warn({ userId, phase, toPhase }, 'Ignoring invalid phase transition to same phase (LLM error)');
          // Don't transition, stay in current phase
        } else {
          // Valid transition - will execute after appendTurn
          effectivePhase = toPhase as typeof phase;
        }
      }
      
      // 2. Save the turn in the effective phase
      try {
        await conversationContextService.appendTurn(userId, effectivePhase, message, response);
      } catch (err) {
        req.log.warn({ err }, 'Failed to append conversation turn — response not affected');
      }

      // 3. Execute validated phase transition AFTER turn is saved
      if (phaseTransition && effectivePhase !== phase) {
        const { toPhase } = phaseTransition;
        try {
          // Prepare options for training phase
          const options: Parameters<typeof conversationContextService.startNewPhase>[4] = {};
          if (toPhase === 'training' && phaseTransition.sessionId) {
            options.trainingContext = { activeSessionId: phaseTransition.sessionId };
          }

          // Execute transition
          await conversationContextService.startNewPhase(
            userId, phase, toPhase,
            `Phase transition: ${phase} → ${toPhase}${phaseTransition.reason ? ` (${phaseTransition.reason})` : ''}`,
            options,
          );
          req.log.info({ userId, from: phase, to: toPhase, reason: phaseTransition.reason }, 'Phase transition executed');
        } catch (err) {
          req.log.error({ err, userId, from: phase, to: toPhase }, 'Phase transition failed validation or execution');
          // Transition failed but user already got response - this is acceptable per ADR-0005 [BR-CONV-007]
        }
      }

      // Return response [AC-0110]
      return reply.send({
        data: {
          content: response,
          timestamp: new Date().toISOString(),
          registrationComplete: true, // Always true here (registration complete)
        },
      });
    } catch (error) {
      req.log.error({ err: error }, 'Chat processing failed');
      return reply.code(500).send({
        error: { message: 'Processing failed', details: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}
