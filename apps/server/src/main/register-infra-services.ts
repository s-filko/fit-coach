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

  // Training domain
  const { TrainingService } = await import('@domain/training/services/training.service');
  const { ExerciseRepository } = await import('@infra/db/repositories/exercise.repository');
  const { WorkoutPlanRepository } = await import('@infra/db/repositories/workout-plan.repository');
  const { WorkoutSessionRepository } = await import('@infra/db/repositories/workout-session.repository');
  const { SessionExerciseRepository } = await import('@infra/db/repositories/session-exercise.repository');
  const { SessionSetRepository } = await import('@infra/db/repositories/session-set.repository');
  const {
    EXERCISE_REPOSITORY_TOKEN,
    SESSION_EXERCISE_REPOSITORY_TOKEN,
    SESSION_SET_REPOSITORY_TOKEN,
    TRAINING_SERVICE_TOKEN,
    WORKOUT_PLAN_REPOSITORY_TOKEN,
    WORKOUT_SESSION_REPOSITORY_TOKEN,
  } = await import('@domain/training/ports');

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
    c => new ChatService(
      c.get(PROMPT_SERVICE_TOKEN),
      c.get(LLM_SERVICE_TOKEN),
      c.get(CONVERSATION_CONTEXT_SERVICE_TOKEN),
    ),
  );

  // Training repositories
  container.register(EXERCISE_REPOSITORY_TOKEN, new ExerciseRepository());
  container.register(WORKOUT_PLAN_REPOSITORY_TOKEN, new WorkoutPlanRepository());
  container.register(WORKOUT_SESSION_REPOSITORY_TOKEN, new WorkoutSessionRepository());
  container.register(SESSION_EXERCISE_REPOSITORY_TOKEN, new SessionExerciseRepository());
  container.register(SESSION_SET_REPOSITORY_TOKEN, new SessionSetRepository());

  // Training service
  container.registerFactory(
    TRAINING_SERVICE_TOKEN,
    c =>
      new TrainingService(
        c.get(WORKOUT_PLAN_REPOSITORY_TOKEN),
        c.get(WORKOUT_SESSION_REPOSITORY_TOKEN),
        c.get(EXERCISE_REPOSITORY_TOKEN),
        c.get(SESSION_EXERCISE_REPOSITORY_TOKEN),
        c.get(SESSION_SET_REPOSITORY_TOKEN),
        c.get(USER_REPOSITORY_TOKEN),
        c.get(LLM_SERVICE_TOKEN),
      ),
  );

  return container;
}
