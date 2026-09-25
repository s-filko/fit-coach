import type { RunnableConfig } from '@langchain/core/runnables';

import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';
import type { IExerciseRepository, ITrainingService, IWorkoutPlanRepository } from '@domain/training/ports';
import type { IUserFactsService, UserFact } from '@domain/user/ports/user-facts.ports';
import type { ExerciseWithMuscles } from '@domain/training/types';

import { HANDOFF_REGISTERED_TEXT } from '@infra/ai/graph/handoff';
import { toToolMessage } from '@infra/ai/tools/outcome';

import { buildStartTrainingSessionTool } from '../start-training-session.tool';

// StructuredTool has overloaded .invoke() signatures that TS cannot unify in tests.
type InvokableTool = {
  name: string;
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

/** Renders a tool return exactly as the executor will (Task 5 contract). */
function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

const MINIMAL_SESSION_PLAN = {
  sessionKey: 'upper_a',
  sessionName: 'Upper A - Chest/Back',
  reasoning: 'Last trained upper body 3 days ago. Good recovery.',
  exercises: [
    {
      exerciseId: 'c7b0899c-a0f9-47ca-a69d-4bcd531b0c95',
      exerciseName: 'Bench Press',
      targetSets: 3,
      targetReps: '8-10',
      restSeconds: 90,
    },
  ],
  estimatedDuration: 60,
};

const makeTrainingService = (sessionId = 'session-1'): jest.Mocked<ITrainingService> =>
  ({
    startSession: jest.fn().mockResolvedValue({ id: sessionId, status: 'planning' }),
    getSessionDetails: jest.fn(),
    completeSession: jest.fn(),
    skipSession: jest.fn(),
    getTrainingHistory: jest.fn(),
    addExerciseToSession: jest.fn(),
    logSet: jest.fn(),
    completeCurrentExercise: jest.fn(),
    ensureCurrentExercise: jest.fn(),
  }) as unknown as jest.Mocked<ITrainingService>;

const makeWorkoutPlanRepo = (planId = 'plan-1'): jest.Mocked<IWorkoutPlanRepository> =>
  ({
    findActiveByUserId: jest.fn().mockResolvedValue({ id: planId }),
    create: jest.fn(),
    findById: jest.fn(),
    findByUserId: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
  }) as unknown as jest.Mocked<IWorkoutPlanRepository>;

const makeConfig = (userId = 'u1'): RunnableConfig =>
  // `context` is the LangGraph run context the graph threads to tools (not a
  // stock RunnableConfig field — hence the cast); ctxOf reads `now` from it for
  // the facts constraint check (fact-lifecycle Task 1).
  ({
    configurable: { userId, thread_id: userId },
    context: { runId: 'run-test', userId, now: new Date('2026-09-20T12:00:00Z') },
  }) as unknown as RunnableConfig;

const makeExerciseRepository = (): jest.Mocked<IExerciseRepository> =>
  ({
    findByIds: jest.fn().mockResolvedValue([]),
    searchByEmbedding: jest.fn().mockResolvedValue([]),
    updateEmbedding: jest.fn(),
    findAll: jest.fn(),
    findAllWithMuscles: jest.fn(),
    findById: jest.fn(),
    findByIdWithMuscles: jest.fn(),
    findByIdsWithMuscles: jest
      .fn()
      .mockResolvedValue([makeExerciseWithMuscles([{ muscleGroup: 'chest', involvement: 'primary' }])]),
    findByMuscleGroup: jest.fn(),
    search: jest.fn(),
  }) as unknown as jest.Mocked<IExerciseRepository>;

const makeExerciseWithMuscles = (
  muscleGroups: ExerciseWithMuscles['muscleGroups'],
  id = 'c7b0899c-a0f9-47ca-a69d-4bcd531b0c95',
  name = 'Bench Press',
): ExerciseWithMuscles => ({
  id,
  name,
  category: 'compound',
  equipment: 'barbell',
  exerciseType: 'strength',
  description: null,
  energyCost: 'high',
  complexity: 'intermediate',
  typicalDurationMinutes: 12,
  requiresSpotter: false,
  imageUrl: null,
  videoUrl: null,
  createdAt: new Date(),
  muscleGroups,
});

const makeConstraintFact = (muscleGroup: UserFact['muscleGroup'], overrides: Partial<UserFact> = {}): UserFact => ({
  id: 'fact-1',
  userId: 'u1',
  category: 'physical_constraint',
  fact: 'User has a shoulder injury — avoid direct chest pressing.',
  factKey: 'shoulder-injury',
  muscleGroup,
  confirmations: 1,
  sourceTurnId: null,
  durability: 'permanent',
  expiresAt: null,
  reviewAfter: null,
  phaseNote: null,
  phaseAt: null,
  onExpiry: null,
  status: 'active',
  archivedAt: null,
  archivedReason: null,
  closedByUserAt: null,
  supersedesId: null,
  context: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeUserFactsService = (constraints: UserFact[] = []): jest.Mocked<IUserFactsService> =>
  ({
    upsertMany: jest.fn(),
    getForPrompt: jest.fn(),
    getConstraints: jest.fn().mockResolvedValue(constraints),
  }) as unknown as jest.Mocked<IUserFactsService>;

const buildTools = (
  trainingService: jest.Mocked<ITrainingService>,
  workoutPlanRepository: jest.Mocked<IWorkoutPlanRepository>,
  userFactsService: jest.Mocked<IUserFactsService> = makeUserFactsService(),
  exerciseRepository: jest.Mocked<IExerciseRepository> = makeExerciseRepository(),
) => {
  const startTrainingSession = buildStartTrainingSessionTool({
    trainingService,
    workoutPlanRepository,
    exerciseRepository,
    userFactsService,
  }) as unknown as InvokableTool;
  return { startTrainingSession };
};

describe('start-training-session.tool — start_training_session', () => {
  it('returns a ToolReturn with update, never a Command object', async () => {
    const { startTrainingSession } = buildTools(makeTrainingService(), makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig())) as ToolReturn;

    expect(result as object).not.toHaveProperty('lc_direct_tool_output');
    expect(isToolReturnWithUpdate(result)).toBe(true);
  });

  it('calls trainingService.startSession with correct args including planId and sessionPlanJson', async () => {
    const trainingService = makeTrainingService();
    const workoutPlanRepo = makeWorkoutPlanRepo('plan-42');
    const { startTrainingSession } = buildTools(trainingService, workoutPlanRepo);

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'));

    expect(trainingService.startSession).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        planId: 'plan-42',
        sessionKey: MINIMAL_SESSION_PLAN.sessionKey,
        status: 'planning',
        sessionPlanJson: expect.objectContaining({
          sessionKey: MINIMAL_SESSION_PLAN.sessionKey,
          sessionName: MINIMAL_SESSION_PLAN.sessionName,
          exercises: MINIMAL_SESSION_PLAN.exercises,
          estimatedDuration: MINIMAL_SESSION_PLAN.estimatedDuration,
        }),
      }),
    );
  });

  it('requests activeSessionId update with the created session ID', async () => {
    const { startTrainingSession } = buildTools(makeTrainingService('session-xyz'), makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'))) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.activeSessionId : undefined).toBe('session-xyz');
  });

  it('requests pendingTransition to the training phase', async () => {
    const { startTrainingSession } = buildTools(makeTrainingService(), makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'))) as ToolReturn;

    expect(isToolReturnWithUpdate(result) ? result.update.pendingTransition : undefined).toEqual({
      toPhase: 'training',
      reason: 'session_planning_complete',
    });
  });

  it('resolves planId from workoutPlanRepository.findActiveByUserId', async () => {
    const workoutPlanRepo = makeWorkoutPlanRepo();
    const { startTrainingSession } = buildTools(makeTrainingService(), workoutPlanRepo);

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u99'));

    expect(workoutPlanRepo.findActiveByUserId).toHaveBeenCalledWith('u99');
  });

  it('includes session ID in success string', async () => {
    const { startTrainingSession } = buildTools(makeTrainingService('session-1'), makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig())) as ToolReturn;

    expect(renderedContent(result)).toContain('session-1');
  });

  it('rejects a session whose exercise PRIMARILY trains a constrained muscle group, quoting the fact', async () => {
    const trainingService = makeTrainingService();
    const workoutPlanRepo = makeWorkoutPlanRepo();
    const fact = makeConstraintFact('chest'); // Bench Press's primary muscle in the mock
    const { startTrainingSession } = buildTools(trainingService, workoutPlanRepo, makeUserFactsService([fact]));

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'))) as ToolReturn;

    expect(result).toEqual({
      ok: false,
      kind: 'user_error',
      message: expect.stringContaining('User has a shoulder injury — avoid direct chest pressing.'),
    });
    // persists nothing and requests no state update
    expect(trainingService.startSession).not.toHaveBeenCalled();
    expect(isToolReturnWithUpdate(result)).toBe(false);
  });

  it('does NOT reject when the constrained muscle is only a secondary muscle', async () => {
    const trainingService = makeTrainingService('session-ok');
    const exerciseRepository = makeExerciseRepository();
    exerciseRepository.findByIdsWithMuscles.mockResolvedValue([
      makeExerciseWithMuscles([
        { muscleGroup: 'chest', involvement: 'primary' },
        { muscleGroup: 'triceps', involvement: 'secondary' },
      ]),
    ]);
    const { startTrainingSession } = buildTools(
      trainingService,
      makeWorkoutPlanRepo(),
      makeUserFactsService([makeConstraintFact('triceps')]),
      exerciseRepository,
    );

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'))) as ToolReturn;

    expect(isToolReturnWithUpdate(result)).toBe(true);
    expect(trainingService.startSession).toHaveBeenCalledTimes(1);
  });

  // AC-FL-6: only a `permanent` constraint blocks; everything else advises.
  describe('non-permanent constraints advise instead of blocking (AC-FL-6)', () => {
    const DEADLIFT = { id: '11111111-1111-4111-8111-111111111111', name: 'Conventional Deadlift' };
    const ROW = { id: '22222222-2222-4222-8222-222222222222', name: 'Barbell Row' };
    const HYPER = { id: '33333333-3333-4333-8333-333333333333', name: 'Hyperextension' };
    const lowerBackPrimary = [{ muscleGroup: 'lower_back' as const, involvement: 'primary' as const }];

    const sessionWithThreeProblemExercises = () => ({
      ...MINIMAL_SESSION_PLAN,
      exercises: [DEADLIFT, ROW, HYPER].map(e => ({
        exerciseId: e.id,
        exerciseName: e.name,
        targetSets: 3,
        targetReps: '8',
        restSeconds: 90,
      })),
    });
    const catalogWithThreeProblemExercises = () => {
      const exerciseRepository = makeExerciseRepository();
      exerciseRepository.findByIdsWithMuscles.mockResolvedValue(
        [DEADLIFT, ROW, HYPER].map(e => makeExerciseWithMuscles(lowerBackPrimary, e.id, e.name)),
      );
      return exerciseRepository;
    };

    it.each(['long_term', 'short'] as const)(
      'a %s constraint no longer rejects: the session starts and the result names the fact and EVERY conflicting exercise',
      async durability => {
        const trainingService = makeTrainingService('session-adv');
        const fact = makeConstraintFact('lower_back', { durability, fact: 'Lower back is sore after a fall' });
        const { startTrainingSession } = buildTools(
          trainingService,
          makeWorkoutPlanRepo(),
          makeUserFactsService([fact]),
          catalogWithThreeProblemExercises(),
        );

        const result = (await startTrainingSession.invoke(
          sessionWithThreeProblemExercises(),
          makeConfig('u1'),
        )) as ToolReturn;

        expect(trainingService.startSession).toHaveBeenCalledTimes(1); // persisted
        expect(isToolReturnWithUpdate(result) ? result.update.activeSessionId : undefined).toBe('session-adv');
        const text = renderedContent(result);
        expect(text).toContain('Session created (ID: session-adv)');
        expect(text).toContain('ADVISORY');
        expect(text).toContain('Lower back is sore after a fall');
        for (const name of [DEADLIFT.name, ROW.name, HYPER.name]) {
          expect(text).toContain(name); // not just the first
        }
        expect(text).toMatch(/must address/i);
      },
    );

    it('a permanent constraint still rejects, listing every conflicting exercise; nothing is persisted', async () => {
      const trainingService = makeTrainingService();
      const { startTrainingSession } = buildTools(
        trainingService,
        makeWorkoutPlanRepo(),
        makeUserFactsService([makeConstraintFact('lower_back', { durability: 'permanent' })]),
        catalogWithThreeProblemExercises(),
      );

      const result = (await startTrainingSession.invoke(
        sessionWithThreeProblemExercises(),
        makeConfig('u1'),
      )) as ToolReturn;

      expect(result).toMatchObject({ ok: false, kind: 'user_error' });
      for (const name of [DEADLIFT.name, ROW.name, HYPER.name]) {
        expect((result as { message: string }).message).toContain(name);
      }
      expect(trainingService.startSession).not.toHaveBeenCalled();
      expect(isToolReturnWithUpdate(result)).toBe(false);
    });

    it('a non-permanent constraint with no intersecting exercise leaves the summary free of any advisory', async () => {
      const { startTrainingSession } = buildTools(
        makeTrainingService('session-1'),
        makeWorkoutPlanRepo(),
        makeUserFactsService([makeConstraintFact('abs', { durability: 'short' })]),
      );

      const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'))) as ToolReturn;

      expect(renderedContent(result)).not.toContain('ADVISORY');
      expect(renderedContent(result)).toContain('Session created (ID: session-1)');
    });
  });

  it('returns error string when userId is missing', async () => {
    const { startTrainingSession } = buildTools(makeTrainingService(), makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, { configurable: {} })) as ToolReturn;

    expect(renderedContent(result)).toContain('Error: could not identify user');
  });

  it('does NOT request updates when userId is missing', async () => {
    const { startTrainingSession } = buildTools(makeTrainingService(), makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, { configurable: {} })) as ToolReturn;

    expect(isToolReturnWithUpdate(result)).toBe(false);
  });

  it('returns error string when trainingService.startSession throws', async () => {
    const trainingService = makeTrainingService();
    trainingService.startSession.mockRejectedValue(new Error('DB connection failed'));
    const { startTrainingSession } = buildTools(trainingService, makeWorkoutPlanRepo());

    const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('u1'))) as ToolReturn;

    expect(renderedContent(result)).toContain('Error creating session');
    expect(renderedContent(result)).toContain('DB connection failed');
    // no state update on error
    expect(isToolReturnWithUpdate(result)).toBe(false);
  });

  it('works when no active plan exists (planId is undefined)', async () => {
    const workoutPlanRepo = makeWorkoutPlanRepo();
    workoutPlanRepo.findActiveByUserId.mockResolvedValue(null);
    const trainingService = makeTrainingService();
    const { startTrainingSession } = buildTools(trainingService, workoutPlanRepo);

    await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig());

    expect(trainingService.startSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ planId: undefined }),
    );
  });

  describe('D-5: closing text depends on TRANSITION_HANDOFF_TARGETS', () => {
    it('keeps the "write a message" wording when the flag is off (no transitionHandoffTargets)', async () => {
      const { startTrainingSession } = buildTools(makeTrainingService(), makeWorkoutPlanRepo());

      const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig())) as ToolReturn;

      const text = renderedContent(result);
      expect(text).toContain('Now write a brief energetic message');
      expect(text).not.toContain(HANDOFF_REGISTERED_TEXT);
    });

    it('keeps the "write a message" wording when training is NOT in transitionHandoffTargets', async () => {
      const startTrainingSession = buildStartTrainingSessionTool({
        trainingService: makeTrainingService(),
        workoutPlanRepository: makeWorkoutPlanRepo(),
        exerciseRepository: makeExerciseRepository(),
        userFactsService: makeUserFactsService(),
        transitionHandoffTargets: new Set(['session_planning']),
      }) as unknown as InvokableTool;

      const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig())) as ToolReturn;

      expect(renderedContent(result)).toContain('Now write a brief energetic message');
    });

    it('switches to the neutral hand-off text when training IS a hand-off target', async () => {
      const startTrainingSession = buildStartTrainingSessionTool({
        trainingService: makeTrainingService(),
        workoutPlanRepository: makeWorkoutPlanRepo(),
        exerciseRepository: makeExerciseRepository(),
        userFactsService: makeUserFactsService(),
        transitionHandoffTargets: new Set(['training']),
      }) as unknown as InvokableTool;

      const result = (await startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig())) as ToolReturn;

      const text = renderedContent(result);
      expect(text).toContain(HANDOFF_REGISTERED_TEXT);
      expect(text).not.toContain('write a brief energetic message');
      // The session facts still render — only the closing instruction changes.
      expect(text).toContain('Session created (ID: session-1)');
    });
  });

  it('each invocation requests its own session — two users do not overwrite each other', async () => {
    const trainingA = makeTrainingService('session-A');
    const trainingB = makeTrainingService('session-B');

    const toolsA = buildTools(trainingA, makeWorkoutPlanRepo());
    const a = (await toolsA.startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('userA'))) as ToolReturn;

    const toolsB = buildTools(trainingB, makeWorkoutPlanRepo());
    const b = (await toolsB.startTrainingSession.invoke(MINIMAL_SESSION_PLAN, makeConfig('userB'))) as ToolReturn;

    expect(isToolReturnWithUpdate(a) ? a.update.activeSessionId : undefined).toBe('session-A');
    expect(isToolReturnWithUpdate(b) ? b.update.activeSessionId : undefined).toBe('session-B');
  });
});
