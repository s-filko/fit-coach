import { Container } from '@infra/di/container';

// Global container instance
let _globalContainer: Container | null = null;

export function getGlobalContainer(): Container {
  _globalContainer ??= new Container();
  return _globalContainer;
}

/**
 * Registers all infrastructure service implementations in the DI container
 * This function should be called from the bootstrap process
 */
export async function registerInfraServices(container: Container = getGlobalContainer()): Promise<void> {
  // Lazy load all dependencies to avoid circular imports and config loading issues
  const { ensureSchema } = await import('@infra/db/init');
  const { DrizzleUserRepository } = await import('@infra/db/repositories/user.repository');
  const { LLMService } = await import('@infra/ai/llm.service');
  const { ProfileParserService } = await import('@domain/user/services/profile-parser.service');
  const { PromptService } = await import('@domain/user/services/prompt.service');
  const { RegistrationService } = await import('@domain/user/services/registration.service');
  const { UserService } = await import('@domain/user/services/user.service');
  const { LLM_SERVICE_TOKEN } = await import('@domain/ai/ports');
  const { 
    PROFILE_PARSER_SERVICE_TOKEN,
    PROMPT_SERVICE_TOKEN,
    REGISTRATION_SERVICE_TOKEN,
    USER_REPOSITORY_TOKEN,
    USER_SERVICE_TOKEN,
  } = await import('@domain/user/ports');

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
