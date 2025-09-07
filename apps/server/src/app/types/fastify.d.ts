import { LLMService } from '@domain/ai/ports';
import { IRegistrationService, IUserService } from '@domain/user/ports';

declare module 'fastify' {
  interface FastifyInstance {
    services: {
      userService: IUserService;
      registrationService: IRegistrationService;
      llmService: LLMService;
    };
  }
}
