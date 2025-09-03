import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
import { ILLMService } from '@infra/ai/llm.service';
import { UserService } from '@domain/user/services/user.service';
import { IRegistrationService } from '@domain/user/services/registration.service';

const chatMessageBody = z.object({
  userId: z.string().min(1).describe('User ID'),
  message: z.string().min(1).describe('User message'),
}).describe('Chat message payload');

export async function registerChatRoutes(app: FastifyInstance) {
  app.post('/api/chat', {
    schema: {
      summary: 'Send chat message to AI',
      body: chatMessageBody,
      security: [{ ApiKeyAuth: [] } as any],
      response: {
        200: z.object({
          data: z.object({
            content: z.string(),
            timestamp: z.string(),
            registrationComplete: z.boolean().optional()
          })
        }),
        400: z.object({ error: z.object({ message: z.string() }) }),
        401: z.object({ error: z.object({ message: z.string() }) }),
        403: z.object({ error: z.object({ message: z.string() }) }),
        404: z.object({ error: z.object({ message: z.string() }) }),
        500: z.object({ error: z.object({ message: z.string() }) }),
      },
    },
  }, async (req, reply) => {
    try {
      const container = Container.getInstance();
      const userService = container.get<UserService>(TOKENS.USER_SERVICE);
      const registrationService = container.get<IRegistrationService>(TOKENS.REGISTRATION_SERVICE);
      const llmService = container.get<ILLMService>(TOKENS.LLM);

      const { userId, message } = req.body as any;

      // Get user data
      const user = await userService.getUser(userId);
      if (!user) {
        return reply.code(404).send({
          error: { message: 'User not found' }
        });
      }

      let response: string;
      let updatedUser = user;

      // Check registration status
      if (userService.isRegistrationComplete(user)) {
        // Registration complete - normal chat mode
        response = await llmService.generateResponse(message, false);
      } else {
        // Registration incomplete - profile data collection mode
        const result = await registrationService.processUserMessage(user, message);
        response = result.response;
        updatedUser = result.updatedUser;

        // Save user profile changes
        if (result.updatedUser !== user) {
          await userService.updateProfileData(userId, {
            profileStatus: updatedUser.profileStatus,
            age: updatedUser.age,
            gender: updatedUser.gender,
            height: updatedUser.height,
            weight: updatedUser.weight,
            fitnessLevel: updatedUser.fitnessLevel,
            fitnessGoal: updatedUser.fitnessGoal
          });
        }
      }

      return reply.send({
        data: {
          content: response,
          timestamp: new Date().toISOString(),
          registrationComplete: userService.isRegistrationComplete(updatedUser)
        }
      });
    } catch (error) {
      console.error('Chat error:', error);
      return reply.code(500).send({
        error: { message: 'Processing failed' }
      });
    }
  });
}
