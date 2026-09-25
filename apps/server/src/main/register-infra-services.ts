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
export async function registerInfraServices(container: Container = getGlobalContainer()): Promise<Container> {
  // Lazy load all dependencies to avoid circular imports and config loading issues
  const { DrizzleUserRepository } = await import('@infra/db/repositories/user.repository');
  const { UserService } = await import('@domain/user/services/user.service');
  const { USER_REPOSITORY_TOKEN, USER_SERVICE_TOKEN, USER_FACTS_SERVICE_TOKEN } = await import('@domain/user/ports');
  const { UserFactsRepository } = await import('@infra/db/repositories/user-facts.repository');

  // Training domain
  const { TrainingService } = await import('@domain/training/services/training.service');
  const { ExerciseRepository } = await import('@infra/db/repositories/exercise.repository');
  const { WorkoutPlanRepository } = await import('@infra/db/repositories/workout-plan.repository');
  const { WorkoutSessionRepository } = await import('@infra/db/repositories/workout-session.repository');
  const { SessionExerciseRepository } = await import('@infra/db/repositories/session-exercise.repository');
  const { SessionSetRepository } = await import('@infra/db/repositories/session-set.repository');
  const {
    EMBEDDING_SERVICE_TOKEN,
    EXERCISE_REPOSITORY_TOKEN,
    SESSION_EXERCISE_REPOSITORY_TOKEN,
    SESSION_SET_REPOSITORY_TOKEN,
    TRAINING_SERVICE_TOKEN,
    WORKOUT_PLAN_REPOSITORY_TOKEN,
    WORKOUT_SESSION_REPOSITORY_TOKEN,
  } = await import('@domain/training/ports');

  // Embedding service — loaded lazily, warm-up triggered below after all registrations
  const { EmbeddingService } = await import('@infra/ai/embedding.service');
  const embeddingService = new EmbeddingService();
  container.register(EMBEDDING_SERVICE_TOKEN, embeddingService);

  // Register infrastructure implementations
  container.register(USER_REPOSITORY_TOKEN, new DrizzleUserRepository());
  container.registerFactory(USER_SERVICE_TOKEN, c => new UserService(c.get(USER_REPOSITORY_TOKEN)));
  container.register(USER_FACTS_SERVICE_TOKEN, new UserFactsRepository());

  const { OpenAiLlmGateway } = await import('@infra/ai/llm.gateway');
  const { LLM_GATEWAY_TOKEN } = await import('@domain/ai/ports');
  container.register(LLM_GATEWAY_TOKEN, new OpenAiLlmGateway());

  // Training repositories
  container.register(EXERCISE_REPOSITORY_TOKEN, new ExerciseRepository());
  container.register(WORKOUT_PLAN_REPOSITORY_TOKEN, new WorkoutPlanRepository());
  container.register(WORKOUT_SESSION_REPOSITORY_TOKEN, new WorkoutSessionRepository());
  container.register(SESSION_EXERCISE_REPOSITORY_TOKEN, new SessionExerciseRepository());
  container.register(SESSION_SET_REPOSITORY_TOKEN, new SessionSetRepository());

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
        c.get(EMBEDDING_SERVICE_TOKEN),
      ),
  );

  // PostgreSQL checkpointer for LangGraph state persistence
  const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
  const { loadConfig } = await import('@config/index');
  const config = loadConfig();
  const connString = `postgresql://${config.DB_USER}:${config.DB_PASSWORD}@${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME}`;
  const checkpointer = PostgresSaver.fromConnString(connString);
  await checkpointer.setup();

  const { buildConversationGraph, CONVERSATION_GRAPH_TOKEN } = await import('@infra/ai/graph/conversation.graph');
  const { buildConversationRunner } = await import('@infra/ai/graph/conversation-run.adapter');
  const { CONVERSATION_RUN_SERVICE_TOKEN, CONVERSATION_RUN_PORT_TOKEN } = await import('@domain/conversation/ports');
  const { DrizzleConversationRunService } = await import('@infra/conversation/drizzle-conversation-run.service');
  container.register(CONVERSATION_RUN_SERVICE_TOKEN, new DrizzleConversationRunService());
  const { SUMMARY_PORT_TOKEN, TRANSCRIPT_PORT_TOKEN } = await import('@domain/conversation/ports');
  const { DrizzleTranscriptService } = await import('@infra/conversation/drizzle-transcript.service');
  const { DrizzleSummaryService } = await import('@infra/conversation/drizzle-summary.service');
  container.register(TRANSCRIPT_PORT_TOKEN, new DrizzleTranscriptService());
  container.register(SUMMARY_PORT_TOKEN, new DrizzleSummaryService());
  // The graph token stays internal to infra; the app layer sees the port only.
  const graph = buildConversationGraph({
    trainingService: container.get(TRAINING_SERVICE_TOKEN),
    workoutPlanRepo: container.get(WORKOUT_PLAN_REPOSITORY_TOKEN),
    workoutSessionRepo: container.get(WORKOUT_SESSION_REPOSITORY_TOKEN),
    exerciseRepository: container.get(EXERCISE_REPOSITORY_TOKEN),
    embeddingService: container.get(EMBEDDING_SERVICE_TOKEN),
    userService: container.get(USER_SERVICE_TOKEN),
    runService: container.get(CONVERSATION_RUN_SERVICE_TOKEN),
    transcript: container.get(TRANSCRIPT_PORT_TOKEN),
    summaries: container.get(SUMMARY_PORT_TOKEN),
    userFacts: container.get(USER_FACTS_SERVICE_TOKEN),
    llmGateway: container.get(LLM_GATEWAY_TOKEN),
    // D-L: episode tunables resolved once here — the nodes never read env mid-run.
    episodeConfig: {
      gapMs: config.EPISODE_GAP_HOURS * 3_600_000,
      minTurns: config.EPISODE_MIN_TURNS,
      minTokens: config.EPISODE_MIN_TOKENS,
      keepTurns: config.EPISODE_KEEP_TURNS,
      budgetLowWater: config.EPISODE_BUDGET_LOW_WATER,
    },
    // LLM_BUDGET_* overrides (P4 context-budget plan Task 3), resolved once here.
    budgetOverrides: config.LLM_BUDGETS,
    // AC-FL-5 (course-check plan Task 1): the layer's on/off switch, resolved once here.
    courseCheckEnabled: config.COURSE_CHECK_ENABLED,
    courseCheckRetryCooldownMs: config.COURSE_CHECK_RETRY_COOLDOWN_MINUTES * 60_000,
    courseCheckExpiryAskWindowMs: config.COURSE_CHECK_EXPIRY_ASK_WINDOW_DAYS * 86_400_000,
    checkpointer,
  });
  // The compiled graph under its token: infra-internal, but the scenario
  // runner (evals/lib/run-scenario.ts) needs it for checkpoint seeding
  // (`updateState`) and phase observation (`getState`).
  container.register(CONVERSATION_GRAPH_TOKEN, graph);
  const { withRunMutex } = await import('@infra/conversation/with-run-mutex');
  const runner = buildConversationRunner({
    graph,
    userService: container.get(USER_SERVICE_TOKEN),
    runService: container.get(CONVERSATION_RUN_SERVICE_TOKEN),
    // D-F: clearContext goes through the same checkpointer and transcript.
    checkpointer,
    transcript: container.get(TRANSCRIPT_PORT_TOKEN),
  });
  container.register(
    CONVERSATION_RUN_PORT_TOKEN,
    // D-A, D-12: one conversation run per userId at a time.
    withRunMutex(runner, { waitMs: config.LLM_RUN_MUTEX_WAIT_MS }),
  );

  // Kick off model warm-up in background — do not await so server starts immediately
  void embeddingService.warmUp();

  return container;
}
