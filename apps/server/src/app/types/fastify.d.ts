import { LLMService } from '@domain/ai/ports';
import type { ICompiledConversationGraph } from '@domain/conversation/graph/conversation.graph.ports';
import { IConversationContextService } from '@domain/conversation/ports';
import { ITrainingService } from '@domain/training/ports';
import { IChatService, IRegistrationService, IUserService } from '@domain/user/ports';

declare module 'fastify' {
  interface FastifyInstance {
    services: {
      userService: IUserService;
      registrationService: IRegistrationService;
      chatService: IChatService;
      llmService: LLMService;
      conversationContextService: IConversationContextService;
      trainingService: ITrainingService;
      conversationGraph: ICompiledConversationGraph;
    };
  }
}
