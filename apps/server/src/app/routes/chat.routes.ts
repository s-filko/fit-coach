import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Logger } from '@shared/logger';

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

      const user = await app.services.userService.getUser(userId);
      if (!user) {
        return reply.code(404).send({ error: { message: 'User not found' } });
      }

      const isComplete = app.services.userService.isRegistrationComplete(user);

      // Registration not complete — handled by RegistrationService (Step 3 will migrate this to graph)
      // TODO: remove when Step 3 is done (registration node migrated)
      if (!isComplete) {
        const phase = 'registration' as const;

        const ctx = await conversationContextService.getContext(userId, phase);
        const historyMessages = ctx ? conversationContextService.getMessagesForPrompt(ctx) : [];

        const log = req.log.child({ userId, phase }) as Logger;

        const result = await app.services.registrationService.processUserMessage(
          user, message, historyMessages, { log },
        );
        const { response, updatedUser, phaseTransition } = result;

        await app.services.userService.updateProfileData(userId, {
          profileStatus: updatedUser.profileStatus,
          firstName: updatedUser.firstName,
          age: updatedUser.age,
          gender: updatedUser.gender,
          height: updatedUser.height,
          weight: updatedUser.weight,
          fitnessLevel: updatedUser.fitnessLevel,
          fitnessGoal: updatedUser.fitnessGoal,
        });

        try {
          await conversationContextService.appendTurn(userId, phase, message, response);
        } catch (err) {
          req.log.warn({ err }, 'Failed to append conversation turn — response not affected');
        }

        const nowComplete = app.services.userService.isRegistrationComplete(updatedUser);
        if (nowComplete) {
          try {
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

      // Registration complete — determine active phase from conversation contexts
      // Priority: training > session_planning > plan_creation > chat
      let phase: 'chat' | 'plan_creation' | 'session_planning' | 'training' = 'chat';

      const [trainingCtx, planningCtx, planCreationCtx] = await Promise.all([
        conversationContextService.getContext(userId, 'training'),
        conversationContextService.getContext(userId, 'session_planning'),
        conversationContextService.getContext(userId, 'plan_creation'),
      ]);

      if (trainingCtx) {
        phase = 'training';
      } else if (planningCtx) {
        phase = 'session_planning';
      } else if (planCreationCtx) {
        phase = 'plan_creation';
      }

      req.log.info({ userId, phase }, 'Routing to graph node');

      const ctx = await conversationContextService.getContext(userId, phase);
      const historyMessages = ctx ? conversationContextService.getMessagesForPrompt(ctx) : [];

      // Invoke graph — graph owns LLM call, parse, side-effects (profileUpdate)
      const graphResult = await app.services.conversationGraph.invoke({
        userId,
        phase,
        messages: historyMessages,
        userMessage: message,
        responseMessage: '',
        requestedTransition: null,
      });

      const response = graphResult.responseMessage;
      const phaseTransition = graphResult.requestedTransition;

      try {
        await conversationContextService.appendTurn(userId, phase, message, response);
      } catch (err) {
        req.log.warn({ err }, 'Failed to append conversation turn — response not affected');
      }

      if (phaseTransition && phaseTransition.toPhase !== phase) {
        try {
          const options: Parameters<typeof conversationContextService.startNewPhase>[4] = {};
          if (phaseTransition.toPhase === 'training' && phaseTransition.sessionId) {
            options.trainingContext = { activeSessionId: phaseTransition.sessionId };
          }

          await conversationContextService.startNewPhase(
            userId, phase, phaseTransition.toPhase,
            `Phase transition: ${phase} → ${phaseTransition.toPhase}${phaseTransition.reason ? ` (${phaseTransition.reason})` : ''}`,
            options,
          );
          req.log.info({ userId, from: phase, to: phaseTransition.toPhase, reason: phaseTransition.reason }, 'Phase transition executed');
        } catch (err) {
          req.log.error({ err, userId, from: phase, to: phaseTransition.toPhase }, 'Phase transition failed');
        }
      } else if (phaseTransition && phaseTransition.toPhase === phase) {
        req.log.warn({ userId, phase }, 'Ignoring invalid phase transition to same phase (LLM error)');
      }

      return reply.send({
        data: {
          content: response,
          timestamp: new Date().toISOString(),
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
