import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Container } from '@infra/di/container';
import { TOKENS } from '@infra/di/tokens';
import { ILLMService } from '@infra/ai/llm.service';

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
            timestamp: z.string()
          }) 
        }),
        400: z.object({ error: z.object({ message: z.string() }) }),
        401: z.object({ error: z.object({ message: z.string() }) }),
        403: z.object({ error: z.object({ message: z.string() }) }),
        500: z.object({ error: z.object({ message: z.string() }) }),
      },
    },
  }, async (req, reply) => {
    try {
      const container = Container.getInstance();
      const llmService = container.get<ILLMService>(TOKENS.LLM);
      
      const { userId, message } = req.body as any;
      
      const aiResponse = await llmService.generateResponse(message);
      
      return reply.send({ 
        data: { 
          content: aiResponse,
          timestamp: new Date().toISOString()
        } 
      });
    } catch (error) {
      console.error('Chat error:', error);
      return reply.code(500).send({ 
        error: { message: 'AI processing failed' } 
      });
    }
  });
}
