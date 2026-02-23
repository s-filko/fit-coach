import type { ICompiledConversationGraph } from '@domain/conversation/graph/conversation.graph.ports';
import { IConversationContextService } from '@domain/conversation/ports';
import { ITrainingService } from '@domain/training/ports';
import { IUserService } from '@domain/user/ports';

declare module 'fastify' {
  interface FastifyInstance {
    services: {
      userService: IUserService;
      conversationContextService: IConversationContextService;
      trainingService: ITrainingService;
      conversationGraph: ICompiledConversationGraph;
    };
  }
}
