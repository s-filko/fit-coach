import { type ConversationRunPort } from '@domain/conversation/ports';
import { ITrainingService } from '@domain/training/ports';
import { IUserService } from '@domain/user/ports';

declare module 'fastify' {
  interface FastifyInstance {
    services: {
      userService: IUserService;
      trainingService: ITrainingService;
      conversationRun: ConversationRunPort;
    };
  }

  interface FastifyRequest {
    telegramUserId?: string;
  }
}
