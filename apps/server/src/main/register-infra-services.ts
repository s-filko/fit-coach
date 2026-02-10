import { Container } from '@infra/di/container';

// Global container instance
let globalContainer: Container | null = null;

export function getGlobalContainer(): Container {
  globalContainer ??= new Container();
  return globalContainer;
}

/**
 * Registers all infrastructure service implementations in the DI container
 * This function should be called from the bootstrap process
 */
export async function registerInfraServices(
  container: Container = getGlobalContainer(),
  opts?: { ensureDb?: boolean },
): Promise<Container> {
  // Lazy load all dependencies to avoid circular imports and config loading issues
  const { ensureSchema } = await import('@infra/db/init');
  const { DrizzleUserRepository } = await import('@infra/db/repositories/user.repository');
  const { LLMService } = await import('@infra/ai/llm.service');
  const { PromptService } = await import('@domain/user/services/prompt.service');
  const { ChatService } = await import('@domain/user/services/chat.service');
  const { RegistrationService } = await import('@domain/user/services/registration.service');
  const { UserService } = await import('@domain/user/services/user.service');
  const { LLM_SERVICE_TOKEN } = await import('@domain/ai/ports');
  const { CONVERSATION_CONTEXT_SERVICE_TOKEN } = await import('@domain/conversation/ports');
  const { DrizzleConversationContextService } = await import('@infra/conversation/drizzle-conversation-context.service');
  const {
    CHAT_SERVICE_TOKEN,
    PROMPT_SERVICE_TOKEN,
    REGISTRATION_SERVICE_TOKEN,
    USER_REPOSITORY_TOKEN,
    USER_SERVICE_TOKEN,
  } = await import('@domain/user/ports');

  // Optionally ensure database schema with error handling (integration/dev only)
  if (opts?.ensureDb) {
    try {
      await ensureSchema();
    } catch (err) {
      throw new Error(`Failed to ensure database schema: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Register infrastructure implementations
  container.register(CONVERSATION_CONTEXT_SERVICE_TOKEN, new DrizzleConversationContextService());
  container.register(USER_REPOSITORY_TOKEN, new DrizzleUserRepository());
  container.registerFactory(USER_SERVICE_TOKEN, c => new UserService(c.get(USER_REPOSITORY_TOKEN)));
  container.register(PROMPT_SERVICE_TOKEN, new PromptService());
  container.register(LLM_SERVICE_TOKEN, new LLMService());
  container.registerFactory(
    REGISTRATION_SERVICE_TOKEN,
    c => new RegistrationService(c.get(PROMPT_SERVICE_TOKEN), c.get(LLM_SERVICE_TOKEN)),
  );
  container.registerFactory(
    CHAT_SERVICE_TOKEN,
    c => new ChatService(c.get(PROMPT_SERVICE_TOKEN), c.get(LLM_SERVICE_TOKEN)),
  );

  return container;
}
