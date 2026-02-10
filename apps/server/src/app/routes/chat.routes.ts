import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { loadConfig } from '@config/index';

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

      // 2. Derive conversation phase
      const isComplete = app.services.userService.isRegistrationComplete(user);
      const phase = isComplete ? 'chat' as const : 'registration' as const;

      // 3-4. Load conversation context and build history [BR-CONV-001, BR-CONV-003]
      const ctx = await conversationContextService.getContext(userId, phase);
      const historyMessages = ctx
        ? conversationContextService.getMessagesForPrompt(ctx)
        : [];

      let response: string;
      let updatedUser = user;

      if (isComplete) {
        // 5a. Chat mode — delegate to ChatService (builds prompt + calls LLM)
        response = await app.services.chatService.processMessage(user, message, historyMessages);
      } else {
        // 5b. Registration mode — pass history to registration service
        const result = await app.services.registrationService.processUserMessage(user, message, historyMessages);
        ({ response, updatedUser } = result);

        // 6. Save user profile changes
        await app.services.userService.updateProfileData(userId, {
          profileStatus: updatedUser.profileStatus,
          age: updatedUser.age,
          gender: updatedUser.gender,
          height: updatedUser.height,
          weight: updatedUser.weight,
          fitnessLevel: updatedUser.fitnessLevel,
          fitnessGoal: updatedUser.fitnessGoal,
        });
      }

      // 7. Persist conversation turn [BR-CONV-002, BR-CONV-007]
      try {
        await conversationContextService.appendTurn(userId, phase, message, response);
      } catch (err) {
        req.log.warn({ err }, 'Failed to append conversation turn — response not affected');
      }

      // 8. Phase transition: registration → chat [BR-CONV-005]
      const nowComplete = app.services.userService.isRegistrationComplete(updatedUser);
      if (!isComplete && nowComplete) {
        try {
          await conversationContextService.startNewPhase(
            userId, 'registration', 'chat', 'Registration complete.',
          );
        } catch (err) {
          req.log.warn({ err }, 'Failed to transition conversation phase');
        }
      }

      // 9. Return response [AC-0110]
      return reply.send({
        data: {
          content: response,
          timestamp: new Date().toISOString(),
          registrationComplete: nowComplete,
        },
      });
    } catch (error) {
      req.log.error({ err: error }, 'Chat processing failed');
      return reply.code(500).send({
        error: { message: 'Processing failed', details: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // Debug route for LLM service (only in development)
  if (loadConfig().NODE_ENV === 'development') {
    app.get('/debug/llm', {
      schema: {
        summary: 'Get LLM debug information',
        security: [{ ApiKeyAuth: [] }],
        response: {
          200: z.object({
            debugInfo: z.record(z.string(), z.unknown()),
            timestamp: z.string(),
          }),
          401: z.object({ error: z.object({ message: z.string() }) }),
          500: z.object({ error: z.object({ message: z.string() }) }),
        },
      },
    }, async(req, reply) => {
      try {
        const debugInfo = app.services.llmService.getDebugInfo();

        return reply.send({
          debugInfo,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        req.log.error({ err: error }, 'Failed to get debug info');
        return reply.code(500).send({
          error: { message: 'Failed to get debug info' },
        });
      }
    });

    app.post('/debug/llm/clear', {
      schema: {
        summary: 'Clear LLM debug history',
        security: [{ ApiKeyAuth: [] }],
        response: {
          200: z.object({
            message: z.string(),
            timestamp: z.string(),
          }),
          401: z.object({ error: z.object({ message: z.string() }) }),
          500: z.object({ error: z.object({ message: z.string() }) }),
        },
      },
    }, async(req, reply) => {
      try {
        app.services.llmService.clearHistory();

        return reply.send({
          message: 'Debug history cleared',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        req.log.error({ err: error }, 'Failed to clear debug history');
        return reply.code(500).send({
          error: { message: 'Failed to clear debug history' },
        });
      }
    });
  }
}
