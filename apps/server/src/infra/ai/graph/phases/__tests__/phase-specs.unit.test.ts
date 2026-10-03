/**
 * PhaseSpec unit tests (refactor-p3-phase-spec Task 1, ADR-0013 §4.2).
 * The five specs are data: names, tool surfaces, layouts, policies and the
 * loaders' returned render data must equal what today's agentNodes load.
 */
import type { ConversationPhase } from '@domain/conversation/ports';

import type { ConversationGraphDeps, PhaseSpec } from '@infra/ai/graph/phase-spec';
import { buildPhaseSpecs } from '@infra/ai/graph/phases';
import { NO_POLICY, type ToolPolicy, TRAINING_TOOL_PRIORITY } from '@infra/ai/graph/tool-policy';
import { PHASE_PROMPTS } from '@infra/ai/prompts';

const FACT = { id: 'f1', fact: 'Lower back: avoid heavy axial loading', category: 'physical_constraint' };

const SESSION_ROW = {
  id: 'session-1',
  sessionKey: 'Upper A',
  status: 'in_progress',
  completedAt: null,
  createdAt: new Date('2026-09-01T09:00:00Z'),
  exercises: [],
};

/** Minimal deps cast: each loader reads only the services it closes over. */
function stubDeps(overrides: Record<string, unknown> = {}): ConversationGraphDeps {
  return {
    userService: { getUser: async () => ({ id: 'u1' }) },
    workoutPlanRepo: { findActiveByUserId: async () => ({ id: 'plan-1', name: 'Plan' }) },
    workoutSessionRepo: {
      findRecentByUserIdWithDetails: async () => [SESSION_ROW],
      findRecentPerformancesForExercise: async () => [],
      // set-kind plan Task 2 (D6/D7): the place-ambiguity and skip lookups.
      findLastSkipsByExercise: async () => [],
    },
    // Constraint + equipment facts.
    userFacts: { getConstraints: async () => [], getForPrompt: async () => [] },
    exerciseRepository: { findByIdsWithMuscles: async () => [] },
    trainingService: { getSessionDetails: async () => SESSION_ROW },
    ...overrides,
  } as unknown as ConversationGraphDeps;
}

function specOf(phase: ConversationPhase): PhaseSpec {
  const spec = buildPhaseSpecs(stubDeps()).find(s => s.name === phase);
  if (!spec) {
    throw new Error(`No spec for ${phase}`);
  }
  return spec;
}

// fact-lifecycle Task 2 (AC-FL-2/AC-FL-8): the memory tools ride with the
// shared tool set, so every phase can list, save, retract and delete facts.
const TOOL_NAMES: Record<ConversationPhase, string[]> = {
  registration: [
    'save_profile_fields',
    'complete_registration',
    'save_timezone',
    'set_language',
    'manage_fact',
    'list_facts',
  ],
  chat: ['update_profile', 'request_transition', 'save_timezone', 'set_language', 'manage_fact', 'list_facts'],
  plan_creation: [
    'search_exercises',
    'save_workout_plan',
    'request_transition',
    'save_timezone',
    'set_language',
    'manage_fact',
    'list_facts',
  ],
  session_planning: [
    'search_exercises',
    'start_training_session',
    'request_transition',
    'save_timezone',
    'set_language',
    'manage_fact',
    'list_facts',
  ],
  training: [
    'search_exercises',
    'get_exercise_history',
    'log_set',
    'complete_current_exercise',
    'finish_training',
    'set_session_place',
    'delete_last_sets',
    'update_last_set',
    'save_timezone',
    'set_language',
    'manage_fact',
    'list_facts',
  ],
};

const PHASES: ConversationPhase[] = ['registration', 'chat', 'plan_creation', 'session_planning', 'training'];

describe('buildPhaseSpecs (ADR-0013 §4.2)', () => {
  it('returns the five specs in ConversationPhase order', () => {
    expect(buildPhaseSpecs(stubDeps()).map(s => s.name)).toEqual(PHASES);
  });

  it.each(PHASES)('%s: modelProfile is default and the prompt is the registry entry', phase => {
    const spec = specOf(phase);
    expect(spec.modelProfile).toBe('default');
    expect(spec.prompt).toBe(PHASE_PROMPTS[phase]);
  });

  it.each(
    Object.entries({
      registration: { system: 2500, longTerm: 1000, domain: 1000, history: 6000, outputReserve: 1500 },
      chat: { system: 3000, longTerm: 1500, domain: 2000, history: 8000, outputReserve: 2000 },
      plan_creation: { system: 4000, longTerm: 1500, domain: 2000, history: 12000, outputReserve: 4000 },
      session_planning: { system: 5000, longTerm: 1500, domain: 6000, history: 8000, outputReserve: 3000 },
      training: { system: 5000, longTerm: 1500, domain: 6000, history: 16000, outputReserve: 2000 },
    }) as Array<[ConversationPhase, Record<string, number>]>,
  )('%s: budget equals the ADR-0013 §3.4 table (tokens, as data — D-D)', (phase, budget) => {
    expect(specOf(phase).budget).toEqual(budget);
  });

  it.each(PHASES)('%s: tools equal today’s per-phase tool list (shared tools included)', phase => {
    expect(specOf(phase).tools.map(t => t.name)).toEqual(TOOL_NAMES[phase]);
  });

  it('registration/chat carry NO_POLICY; plan_creation/session_planning dedup search_exercises', () => {
    expect(specOf('registration').toolPolicy).toEqual(NO_POLICY);
    expect(specOf('chat').toolPolicy).toEqual(NO_POLICY);
    const planning: ToolPolicy = { perTurnDedup: ['search_exercises'], llmErrorBudget: Infinity };
    expect(specOf('plan_creation').toolPolicy).toEqual(planning);
    expect(specOf('session_planning').toolPolicy).toEqual(planning);
  });

  it('training carries the executor policy: priority, log_set dedup, budget 1, no availability filter (D4)', () => {
    const { toolPolicy } = specOf('training');
    expect(toolPolicy.ordering).toEqual(TRAINING_TOOL_PRIORITY);
    expect(toolPolicy.batchDedup).toEqual(['log_set']);
    expect(toolPolicy.llmErrorBudget).toBe(1);

    // Prompt-caching plan D4: no availability filter — every tool is always bound; the BUG-008 rule lives in the tools.
    expect(toolPolicy).not.toHaveProperty('availability');
  });

  it('registration loader returns no loader data (lastMessageTime left the Data types — D-M)', async () => {
    const loaded = await specOf('registration').loadContext(
      { userId: 'u1', user: null, activeSessionId: null },
      stubDeps(),
    );
    expect(loaded).toEqual({ ok: true, data: {} });
  });

  it('chat loader returns hasActivePlan and recentSessions (no lastMessageTime — D-M)', async () => {
    const deps = stubDeps();
    const loaded = await specOf('chat').loadContext({ userId: 'u1', user: null, activeSessionId: null }, deps);
    expect(loaded).toEqual({
      ok: true,
      data: { hasActivePlan: true, recentSessions: [SESSION_ROW] },
    });
  });

  it('plan_creation loader returns no loader data (D-M)', async () => {
    const loaded = await specOf('plan_creation').loadContext(
      { userId: 'u1', user: null, activeSessionId: null },
      stubDeps(),
    );
    expect(loaded).toEqual({ ok: true, data: {} });
  });

  it('session_planning loader returns the context builder output', async () => {
    const deps = stubDeps();
    const loaded = await specOf('session_planning').loadContext(
      { userId: 'u1', user: null, activeSessionId: null },
      deps,
    );
    expect(loaded).toEqual({
      ok: true,
      data: {
        context: {
          activePlan: { id: 'plan-1', name: 'Plan' },
          recentSessions: [SESSION_ROW],
          daysSinceLastWorkout: expect.any(Number),
        },
      },
    });
  });

  it('training loader refuses without an active session (catalog reply)', async () => {
    const loaded = await specOf('training').loadContext(
      { userId: 'u1', user: null, activeSessionId: null },
      stubDeps(),
    );
    expect(loaded).toEqual({ ok: false, reply: 'training_no_active_session' });
  });

  it('training loader refuses when the session is gone (catalog reply)', async () => {
    const deps = stubDeps({ trainingService: { getSessionDetails: async () => null } });
    const loaded = await specOf('training').loadContext(
      { userId: 'u1', user: null, activeSessionId: 'session-1' },
      deps,
    );
    expect(loaded).toEqual({ ok: false, reply: 'training_session_not_found' });
  });

  it('training loader returns the session with empty history, no previous workout and the facts when there is nothing to show (D-M)', async () => {
    const deps = stubDeps({ userFacts: { getForPrompt: async () => [FACT] } });
    const loaded = await specOf('training').loadContext(
      { userId: 'u1', user: null, activeSessionId: 'session-1' },
      deps,
    );
    // findRecentByUserIdWithDetails's stub echoes SESSION_ROW itself — today's own session, excluded by id.
    expect(loaded).toEqual({
      ok: true,
      data: {
        session: SESSION_ROW,
        history: [],
        lastWorkout: null,
        warmupHabit: null,
        profileFacts: [FACT],
        reportedToday: [],
        coachReplied: true,
      },
    });
  });

  it('training loader: facts created after the session start become reportedToday and leave the profile; coachReplied comes from the input', async () => {
    const old = { ...FACT, createdAt: new Date('2026-08-01T09:00:00Z') };
    const fresh = {
      id: 'f2',
      fact: 'Right knee pinched on the squat',
      category: 'physical_constraint',
      createdAt: new Date('2026-09-01T09:30:00Z'),
    };
    const deps = stubDeps({ userFacts: { getForPrompt: async () => [old, fresh] } });
    const first = await specOf('training').loadContext(
      { userId: 'u1', user: null, activeSessionId: 'session-1', coachReplied: false },
      deps,
    );
    expect(first).toMatchObject({
      ok: true,
      data: { profileFacts: [old], reportedToday: [fresh], coachReplied: false },
    });
    const unknown = await specOf('training').loadContext(
      { userId: 'u1', user: null, activeSessionId: 'session-1' },
      deps,
    );
    expect(unknown).toMatchObject({ ok: true, data: { coachReplied: true } });
  });

  it('training loader: one history entry per plan exercise (also not started, with no performances), up to three performances, catalog name wins', async () => {
    const BENCH = 'aaaaaaaa-1111-4111-8111-111111111111';
    const ROW = 'bbbbbbbb-2222-4222-8222-222222222222';
    const session = {
      ...SESSION_ROW,
      sessionPlanJson: {
        sessionKey: 'upper_a',
        sessionName: 'Upper A',
        reasoning: 'progressive overload',
        estimatedDuration: 45,
        exercises: [
          { exerciseId: BENCH, exerciseName: 'Bench Press', targetSets: 3, targetReps: '8', restSeconds: 90 },
          { exerciseId: ROW, exerciseName: 'Row', targetSets: 3, targetReps: '10', restSeconds: 90 },
        ],
      },
    };
    const performance = {
      exerciseId: BENCH,
      completedAt: new Date('2026-08-20T10:00:00Z'),
      sessionExercise: { id: 'se-old', exerciseId: BENCH, sets: [] },
    };
    const skippedAt = new Date('2026-08-27T10:00:00Z');
    const previous = {
      id: 'session-0',
      completedAt: new Date('2026-09-29T10:00:00Z'),
      exercises: [{ exercise: { name: 'Treadmill' } }, { exercise: { name: 'Plank' } }],
    };
    const findRecentPerformancesForExercise = jest.fn(
      async (_userId: string, exerciseId: string, _exclude: string | null, _limit: number) =>
        exerciseId === BENCH ? [performance] : [],
    );
    const findRecentByUserIdWithDetails = jest.fn(async () => [SESSION_ROW, previous]);
    const getForPrompt = jest.fn(async () => [FACT]);
    const deps = stubDeps({
      trainingService: { getSessionDetails: async () => session },
      workoutSessionRepo: {
        findRecentByUserIdWithDetails,
        findRecentPerformancesForExercise,
        findLastSkipsByExercise: async () => [{ exerciseId: ROW, skippedAt }],
      },
      userFacts: { getForPrompt },
      exerciseRepository: {
        findByIdsWithMuscles: async (ids: string[]) => {
          expect(ids).toEqual([BENCH, ROW]);
          return [{ id: BENCH, name: 'Barbell Bench Press', muscleGroups: [] }];
        },
      },
    });

    const now = new Date('2026-10-01T12:00:00Z');
    const loaded = await specOf('training').loadContext(
      { userId: 'u1', user: null, activeSessionId: 'session-1', now },
      deps,
    );

    expect(loaded).toEqual({
      ok: true,
      data: {
        session,
        history: [
          {
            exerciseId: BENCH,
            exerciseName: 'Barbell Bench Press', // catalog name wins over the plan's 'Bench Press' (D19)
            plannedText: '3×8',
            performances: [performance],
            lastSkippedAt: null,
            loadsUsed: [],
          },
          {
            exerciseId: ROW,
            exerciseName: 'Row',
            plannedText: '3×10',
            performances: [],
            lastSkippedAt: skippedAt,
            loadsUsed: [],
          },
        ],
        lastWorkout: { completedAt: previous.completedAt, exerciseNames: ['Treadmill', 'Plank'] },
        warmupHabit: null,
        profileFacts: [FACT],
        reportedToday: [],
        coachReplied: true,
      },
    });
    expect(findRecentPerformancesForExercise).toHaveBeenCalledWith('u1', BENCH, 'session-1', 60);
    expect(findRecentPerformancesForExercise).toHaveBeenCalledWith('u1', ROW, 'session-1', 60);
    expect(findRecentByUserIdWithDetails).toHaveBeenCalledWith('u1', 14, { realWorkoutsOnly: true });
    expect(getForPrompt).toHaveBeenCalledWith('u1', now);
  });

  it('training loader: the warm-up habit comes from the last workouts, the loads from all earlier performances', async () => {
    const workout = (id: string) => ({
      id,
      completedAt: new Date('2026-09-20T10:00:00Z'),
      exercises: [
        {
          orderIndex: 0,
          exercise: { name: 'Treadmill', category: 'cardio' },
          sets: [{ setData: { type: 'cardio_duration', duration: 600 } }],
        },
        { orderIndex: 1, exercise: { name: 'Bench', category: 'compound' }, sets: [] },
      ],
    });
    const PLAN_BENCH = 'aaaaaaaa-1111-4111-8111-111111111111';
    const session = {
      ...SESSION_ROW,
      sessionPlanJson: {
        sessionKey: 'k',
        sessionName: 'S',
        reasoning: '',
        estimatedDuration: 45,
        exercises: [{ exerciseId: PLAN_BENCH, exerciseName: 'Bench', targetSets: 3, targetReps: '8', restSeconds: 90 }],
      },
    };
    const perf = (day: string, weight: number) => ({
      exerciseId: PLAN_BENCH,
      completedAt: new Date(`${day}T10:00:00Z`),
      sessionExercise: { sets: [{ setData: { type: 'strength', reps: 8, weight, weightUnit: 'kg' } }] },
    });
    const deps = stubDeps({
      trainingService: { getSessionDetails: async () => session },
      exerciseRepository: { findByIdsWithMuscles: async () => [] },
      workoutSessionRepo: {
        findLastSkipsByExercise: async () => [],
        findRecentByUserIdWithDetails: async () => [SESSION_ROW, workout('w1'), workout('w2')],
        findRecentPerformancesForExercise: async () => [
          perf('2026-09-27', 60),
          perf('2026-09-20', 50),
          perf('2026-09-13', 55),
          perf('2026-09-06', 50),
        ],
      },
    });
    const loaded = await specOf('training').loadContext(
      { userId: 'u1', user: null, activeSessionId: 'session-1' },
      deps,
    );
    expect(loaded.ok && loaded.data).toMatchObject({
      warmupHabit: { workouts: 2, withCardio: 2, kinds: [{ label: 'treadmill', minMinutes: 10, maxMinutes: 10 }] },
      history: [{ performances: [{}, {}, {}], loadsUsed: [{ weight: 50 }, { weight: 55 }, { weight: 60 }] }],
    });
  });

  it('training loader: off-plan started exercises follow the plan ones, named by the catalog', async () => {
    const OFF = 'cccccccc-3333-4333-8333-333333333333';
    const session = {
      ...SESSION_ROW,
      exercises: [{ exerciseId: OFF, status: 'in_progress', sets: [], exercise: { name: 'Cycling' } }],
    };
    const deps = stubDeps({ trainingService: { getSessionDetails: async () => session } });
    const loaded = await specOf('training').loadContext(
      { userId: 'u1', user: null, activeSessionId: 'session-1' },
      deps,
    );
    expect(loaded.ok && loaded.data).toMatchObject({
      history: [{ exerciseId: OFF, exerciseName: 'Cycling', plannedText: null, performances: [] }],
    });
  });

  it('training loader drops a bad legacy plan row (empty/non-UUID exerciseId) before any DB query (close-out review advisory 6)', async () => {
    const session = {
      ...SESSION_ROW,
      sessionPlanJson: {
        sessionKey: 'upper_a',
        sessionName: 'Upper A',
        reasoning: 'progressive overload',
        estimatedDuration: 45,
        exercises: [
          { exerciseId: '', exerciseName: 'Legacy empty id', targetSets: 3, targetReps: '8', restSeconds: 90 },
          { exerciseId: 'not-a-uuid', exerciseName: 'Legacy bad id', targetSets: 3, targetReps: '8', restSeconds: 90 },
        ],
      },
    };
    const findRecentPerformancesForExercise = jest.fn().mockResolvedValue([]);
    const findByIdsWithMuscles = jest.fn().mockResolvedValue([]);
    const deps = stubDeps({
      trainingService: { getSessionDetails: async () => session },
      workoutSessionRepo: {
        findRecentByUserIdWithDetails: async () => [],
        findRecentPerformancesForExercise,
        findLastSkipsByExercise: async () => [],
      },
      exerciseRepository: { findByIdsWithMuscles },
    });

    const loaded = await specOf('training').loadContext(
      { userId: 'u1', user: null, activeSessionId: 'session-1' },
      deps,
    );

    expect(loaded).toEqual({
      ok: true,
      data: {
        session,
        history: [],
        lastWorkout: null,
        warmupHabit: null,
        profileFacts: [],
        reportedToday: [],
        coachReplied: true,
      },
    });
    // Neither bad id ever reached a DB call — the turn does not fail on a legacy plan row.
    expect(findRecentPerformancesForExercise).not.toHaveBeenCalled();
    expect(findByIdsWithMuscles).not.toHaveBeenCalled();
  });

  it('training: new coach prompt, the two fact blocks, workout memory, no load-engine tool (coach-simplification I1)', () => {
    const spec = specOf('training');
    expect(spec.prompt.current.id).toBe('phase.training');
    expect(spec.prompt.current.version).toBe('v13');
    expect(spec.contextBlocks.map(b => `${b.id}.${b.version}`)).toEqual(['training.today.v1', 'training.history.v1']);
    expect(spec.memory).toBe('workout');
    expect(spec.tools.map(t => t.name)).toContain('get_exercise_history');
    // every other phase keeps the episode memory
    for (const phase of PHASES.filter(p => p !== 'training')) {
      expect(specOf(phase).memory ?? 'episodes').toBe('episodes');
    }
  });
});

// -------------------------------------------------------------------------
// coach-simplification I1: planning is weight-free — session_planning runs v5 with the v2 active-plan block, and
// save_workout_plan / start_training_session carry no targetWeight.
// -------------------------------------------------------------------------

describe('the planner writes no weights (coach-simplification I1)', () => {
  type Shape = { shape: Record<string, unknown> };
  const planningSpec = () => buildPhaseSpecs(stubDeps()).find(s => s.name === 'session_planning')!;
  const planCreationSpec = () => buildPhaseSpecs(stubDeps()).find(s => s.name === 'plan_creation')!;

  it('session_planning: v5 prompt and the active_plan v2 block', () => {
    const spec = planningSpec();
    expect(spec.prompt.current.version).toBe('v5');
    expect(spec.contextBlocks.find(b => b.id === 'session_planning.active_plan')?.version).toBe('v2');
  });

  it('planner tool schemas drop targetWeight', () => {
    const save = (
      planCreationSpec().tools.find(t => t.name === 'save_workout_plan') as unknown as {
        schema: { shape: { sessionTemplates: { element: { shape: { exercises: { element: Shape } } } } } };
      }
    ).schema.shape.sessionTemplates.element.shape.exercises.element.shape;
    const start = (
      planningSpec().tools.find(t => t.name === 'start_training_session') as unknown as {
        schema: { shape: { exercises: { element: Shape } } };
      }
    ).schema.shape.exercises.element.shape;
    expect(save).not.toHaveProperty('targetWeight');
    expect(start).not.toHaveProperty('targetWeight');
  });
});
