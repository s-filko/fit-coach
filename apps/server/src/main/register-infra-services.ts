import { LLM_SERVICE_TOKEN } from '@domain/ai/ports';
import { 
  PROFILE_PARSER_SERVICE_TOKEN,
  PROMPT_SERVICE_TOKEN,
  REGISTRATION_SERVICE_TOKEN,
  USER_REPOSITORY_TOKEN,
  USER_SERVICE_TOKEN,
} from '@domain/user/ports';
import { ProfileParserService } from '@domain/user/services/profile-parser.service';
import { PromptService } from '@domain/user/services/prompt.service';
import { RegistrationService } from '@domain/user/services/registration.service';
import { UserService } from '@domain/user/services/user.service';

import { LLMService } from '@infra/ai/llm.service';
import { ensureSchema } from '@infra/db/init';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { Container } from '@infra/di/container';

// Global container instance
export const globalContainer = new Container();

/**
 * Registers all infrastructure service implementations in the DI container
 * This function should be called from the bootstrap process
 */
export async function registerInfraServices(container: Container = globalContainer): Promise<void> {
  // Register database schema with error handling
  try {
    await ensureSchema();
  } catch (err) {
    throw new Error(`Failed to ensure database schema: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Register infrastructure implementations
  container.register(USER_REPOSITORY_TOKEN, new DrizzleUserRepository());
  container.registerFactory(USER_SERVICE_TOKEN, c => new UserService(c.get(USER_REPOSITORY_TOKEN)));
  container.register(PROMPT_SERVICE_TOKEN, new PromptService());
  container.registerFactory(
    PROFILE_PARSER_SERVICE_TOKEN,
    c => new ProfileParserService(c.get(PROMPT_SERVICE_TOKEN), c.get(LLM_SERVICE_TOKEN)),
  );
  container.registerFactory(
    REGISTRATION_SERVICE_TOKEN,
    c =>
      new RegistrationService(
        c.get(PROFILE_PARSER_SERVICE_TOKEN),
        c.get(PROMPT_SERVICE_TOKEN),
        c.get(LLM_SERVICE_TOKEN),
      ),
  );
  container.registerFactory(LLM_SERVICE_TOKEN, c => {
    const llmService = new LLMService();
    llmService.setPromptService(c.get(PROMPT_SERVICE_TOKEN));
    return llmService;
  });
}
