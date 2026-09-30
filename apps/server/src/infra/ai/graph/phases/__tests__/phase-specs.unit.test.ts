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
      findLastPerformancesByExercise: async () => [],
      // set-kind plan Task 2 (D6/D7): the place-ambiguity and skip lookups.
      distinctRecentPlaces: async () => [],
      findLastSkipsByExercise: async () => [],
      // load-facts plan D11: the all-time count.
      countRealPerformancesByExercise: async () => new Map(),
    },
    // load-facts plan D11: constraint + equipment facts for the LOAD PLAN loader.
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
    'get_load_plan',
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
      training: { system: 5000, longTerm: 1500, domain: 6000, history: 8000, outputReserve: 2000 },
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

  it('training loader returns the session with empty history/recent-workouts when there is nothing to show (D-M)', async () => {
    const deps = stubDeps();
    const loaded = await specOf('training').loadContext(
      { userId: 'u1', user: null, activeSessionId: 'session-1' },
      deps,
    );
    // findRecentByUserIdWithDetails's stub echoes SESSION_ROW itself — today's own session,
    // excluded by id (D3) — so recentWorkouts comes back empty here.
    expect(loaded).toEqual({
      ok: true,
      data: {
        session: SESSION_ROW,
        exerciseHistory: [],
        recentWorkouts: [],
        todayMuscles: [],
        recentPlacesCount: 0,
        loadPlan: [],
      },
    });
  });

  it('training loader anchors exercise history by exercise id, not session_key (BUG-030 D2/D3)', async () => {
    const EXERCISE_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
    const session = {
      ...SESSION_ROW,
      sessionPlanJson: {
        sessionKey: 'upper_a',
        sessionName: 'Upper A',
        reasoning: 'progressive overload',
        estimatedDuration: 45,
        exercises: [
          { exerciseId: EXERCISE_ID, exerciseName: 'Bench Press', targetSets: 3, targetReps: '8', restSeconds: 90 },
        ],
      },
    };
    const performance = {
      exerciseId: EXERCISE_ID,
      completedAt: new Date('2026-08-20T10:00:00Z'),
      sessionExercise: { id: 'se-old', exerciseId: EXERCISE_ID, sets: [] },
    };
    const deps = stubDeps({
      trainingService: { getSessionDetails: async () => session },
      workoutSessionRepo: {
        findRecentByUserIdWithDetails: async () => [],
        findLastPerformancesByExercise: async (userId: string, ids: string[], excludeSessionId: string) => {
          expect(userId).toBe('u1');
          expect(ids).toEqual([EXERCISE_ID]);
          expect(excludeSessionId).toBe('session-1');
          return [performance];
        },
        distinctRecentPlaces: async () => [],
        findLastSkipsByExercise: async () => [],
      },
      exerciseRepository: {
        findByIdsWithMuscles: async (ids: string[]) => {
          expect(ids).toEqual([EXERCISE_ID]);
          return [
            {
              id: EXERCISE_ID,
              name: 'Barbell Bench Press',
              muscleGroups: [{ muscleGroup: 'chest', involvement: 'primary' }],
            },
          ];
        },
      },
    });

    const loaded = await specOf('training').loadContext(
      { userId: 'u1', user: null, activeSessionId: 'session-1' },
      deps,
    );

    expect(loaded).toEqual({
      ok: true,
      data: {
        session,
        exerciseHistory: [
          {
            exerciseId: EXERCISE_ID,
            exerciseName: 'Barbell Bench Press', // catalog name wins over the plan's 'Bench Press' (D19)
            performance: performance.sessionExercise,
            completedAt: performance.completedAt,
            lastSkippedAt: null,
          },
        ],
        recentWorkouts: [],
        todayMuscles: ['chest'],
        recentPlacesCount: 0,
        loadPlan: [],
      },
    });
  });

  it('AC-LF-2: LOAD PLAN renders after RECENT WORKOUTS, entries in plan order then off-plan started (D5)', async () => {
    const PLAN_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
    const OFF_PLAN_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
    const catalog = [
      { id: OFF_PLAN_ID, name: 'Pull-ups', equipment: 'bodyweight', exerciseType: 'strength', muscleGroups: [] },
      { id: PLAN_ID, name: 'Barbell Bench Press', equipment: 'barbell', exerciseType: 'strength', muscleGroups: [] },
    ];
    const session = {
      ...SESSION_ROW,
      place: null,
      startedAt: new Date('2026-09-01T09:00:00Z'),
      sessionPlanJson: {
        sessionKey: 'upper_a',
        sessionName: 'Upper A',
        reasoning: 'r',
        estimatedDuration: 45,
        exercises: [{ exerciseId: PLAN_ID, exerciseName: 'Bench', targetSets: 3, targetReps: '8', restSeconds: 90 }],
      },
      exercises: [{ id: 'se-off', exerciseId: OFF_PLAN_ID, exercise: catalog[0], sets: [], status: 'in_progress' }],
    };
    const deps = stubDeps({
      trainingService: { getSessionDetails: async () => session },
      workoutSessionRepo: {
        findRecentByUserIdWithDetails: async () => [],
        findLastPerformancesByExercise: async () => [],
        distinctRecentPlaces: async () => [],
        findLastSkipsByExercise: async () => [],
        countRealPerformancesByExercise: async () => new Map(),
      },
      exerciseRepository: { findByIdsWithMuscles: async () => catalog },
    });
    const spec = specOf('training');
    const loaded = await spec.loadContext(
      { userId: 'u1', user: null, activeSessionId: 'session-1', now: new Date('2026-09-01T10:00:00Z') },
      deps,
    );
    if (!loaded.ok) {
      throw new Error('loadContext failed');
    }
    const ctx = { now: new Date('2026-09-01T10:00:00Z'), timezone: 'UTC', user: null };
    const rendered = spec.contextBlocks
      .map(b => b.render(loaded.data as never, ctx, 0))
      .filter(Boolean)
      .join('\n');
    expect(rendered.indexOf('=== RECENT WORKOUTS')).toBeGreaterThan(-1);
    expect(rendered.indexOf('=== LOAD PLAN')).toBeGreaterThan(rendered.indexOf('=== RECENT WORKOUTS'));
    // EXERCISE HISTORY also names both exercises — look only inside the LOAD PLAN block.
    const loadPlanText = rendered.slice(rendered.indexOf('=== LOAD PLAN'));
    const plan = loadPlanText.indexOf('Barbell Bench Press [ID:');
    const off = loadPlanText.indexOf('Pull-ups [ID:');
    expect(plan).toBeGreaterThan(-1);
    expect(off).toBeGreaterThan(plan);
  });

  it('LOAD_PLAN_SUGGESTION selects training.load_plan v2; off or absent keeps v1 (load-plan A5)', () => {
    const versionOf = (overrides: Record<string, unknown>): string | undefined =>
      buildPhaseSpecs(stubDeps(overrides))
        .find(s => s.name === 'training')
        ?.contextBlocks.find(b => b.id === 'training.load_plan')?.version;
    expect(versionOf({})).toBe('v1');
    expect(versionOf({ loadPlanSuggestion: false })).toBe('v1');
    expect(versionOf({ loadPlanSuggestion: true })).toBe('v2');
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
    const findLastPerformancesByExercise = jest.fn().mockResolvedValue([]);
    const findByIdsWithMuscles = jest.fn().mockResolvedValue([]);
    const deps = stubDeps({
      trainingService: { getSessionDetails: async () => session },
      workoutSessionRepo: {
        findRecentByUserIdWithDetails: async () => [],
        findLastPerformancesByExercise,
        distinctRecentPlaces: async () => [],
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
      data: { session, exerciseHistory: [], recentWorkouts: [], todayMuscles: [], recentPlacesCount: 0, loadPlan: [] },
    });
    // Neither bad id ever reached a DB call — the turn does not fail on a legacy plan row.
    expect(findLastPerformancesByExercise).not.toHaveBeenCalled();
    expect(findByIdsWithMuscles).not.toHaveBeenCalled();
  });

  describe('training loader — recentPlacesCount / placeAmbiguous ask (set-kind plan D6, B3)', () => {
    it('reports the distinct-place count when today has no place and the threshold is met', async () => {
      const deps = stubDeps({
        trainingService: { getSessionDetails: async () => SESSION_ROW },
        workoutSessionRepo: {
          findRecentByUserIdWithDetails: async () => [],
          findLastPerformancesByExercise: async () => [],
          distinctRecentPlaces: async () => ['Fitness House', 'дома'],
          findLastSkipsByExercise: async () => [],
        },
      });

      const loaded = await specOf('training').loadContext(
        { userId: 'u1', user: null, activeSessionId: 'session-1' },
        deps,
      );

      expect(loaded).toEqual({
        ok: true,
        data: {
          session: SESSION_ROW,
          exerciseHistory: [],
          recentWorkouts: [],
          todayMuscles: [],
          recentPlacesCount: 2,
          loadPlan: [],
        },
      });
    });

    it('reports 0 and never consults the repository when today already states a place (short-circuit)', async () => {
      const session = { ...SESSION_ROW, place: 'дома' };
      const distinctRecentPlaces = jest.fn().mockResolvedValue(['Fitness House', 'дома']);
      const deps = stubDeps({
        trainingService: { getSessionDetails: async () => session },
        workoutSessionRepo: {
          findRecentByUserIdWithDetails: async () => [],
          findLastPerformancesByExercise: async () => [],
          distinctRecentPlaces,
          findLastSkipsByExercise: async () => [],
        },
      });

      const loaded = await specOf('training').loadContext(
        { userId: 'u1', user: null, activeSessionId: 'session-1' },
        deps,
      );

      expect(loaded).toEqual({
        ok: true,
        data: {
          session,
          exerciseHistory: [],
          recentWorkouts: [],
          todayMuscles: [],
          recentPlacesCount: 0,
          loadPlan: [],
        },
      });
      expect(distinctRecentPlaces).not.toHaveBeenCalled();
    });

    it('reports the count below the ambiguity threshold as-is (the block decides, not the loader)', async () => {
      const deps = stubDeps({
        trainingService: { getSessionDetails: async () => SESSION_ROW },
        workoutSessionRepo: {
          findRecentByUserIdWithDetails: async () => [],
          findLastPerformancesByExercise: async () => [],
          distinctRecentPlaces: async () => ['Fitness House'],
          findLastSkipsByExercise: async () => [],
        },
      });

      const loaded = await specOf('training').loadContext(
        { userId: 'u1', user: null, activeSessionId: 'session-1' },
        deps,
      );

      expect(loaded).toEqual({
        ok: true,
        data: {
          session: SESSION_ROW,
          exerciseHistory: [],
          recentWorkouts: [],
          todayMuscles: [],
          recentPlacesCount: 1,
          loadPlan: [],
        },
      });
    });
  });
});

// -------------------------------------------------------------------------
// load-plan plan Task 5b (D10/O1/D1, AC-LP-7): LOAD_PLAN_PLANNER_REBIND swaps the training and
// session_planning prompts to v11/v5 and their blocks to v2, and the planner tools drop
// targetWeight. Off or absent = exactly today's behaviour (v10/v4, v1 blocks, weight in schema).
// -------------------------------------------------------------------------

describe('LOAD_PLAN_PLANNER_REBIND selects the rebound planner (load-plan plan Task 5b, AC-LP-7)', () => {
  const trainingSpecOf = (overrides: Record<string, unknown>) =>
    buildPhaseSpecs(stubDeps(overrides)).find(s => s.name === 'training')!;
  const planningSpecOf = (overrides: Record<string, unknown>) =>
    buildPhaseSpecs(stubDeps(overrides)).find(s => s.name === 'session_planning')!;
  const planCreationSpecOf = (overrides: Record<string, unknown>) =>
    buildPhaseSpecs(stubDeps(overrides)).find(s => s.name === 'plan_creation')!;

  // The rebind needs the suggestion: v11 / v5 start from the LOAD PLAN suggestion.
  const ON = { loadPlanPlannerRebind: true, loadPlanSuggestion: true };

  it('rebind without the suggestion selects nothing: v10 / v4, v1 blocks, weights in the schemas', () => {
    const rebindOnly = { loadPlanPlannerRebind: true };
    const training = trainingSpecOf(rebindOnly);
    expect(training.prompt.current.version).toBe('v10');
    expect(training.contextBlocks.find(b => b.id === 'training.workout_overview')?.version).toBe('v1');
    const planning = planningSpecOf(rebindOnly);
    expect(planning.prompt.current.version).toBe('v4');
    expect(planning.contextBlocks.find(b => b.id === 'session_planning.active_plan')?.version).toBe('v1');
    const start = planning.tools.find(t => t.name === 'start_training_session') as unknown as {
      schema: { shape: { exercises: { element: { shape: Record<string, unknown> } } } };
    };
    expect(start.schema.shape.exercises.element.shape).toHaveProperty('targetWeight');
    const save = planCreationSpecOf(rebindOnly).tools.find(t => t.name === 'save_workout_plan') as unknown as {
      schema: {
        shape: {
          sessionTemplates: { element: { shape: { exercises: { element: { shape: Record<string, unknown> } } } } };
        };
      };
    };
    expect(save.schema.shape.sessionTemplates.element.shape.exercises.element.shape).toHaveProperty('targetWeight');
  });

  it('training: v10 prompt + workout_overview v1 with the flag off or absent', () => {
    for (const overrides of [{}, { loadPlanPlannerRebind: false }]) {
      const spec = trainingSpecOf(overrides);
      expect(spec.prompt.current.version).toBe('v10');
      expect(spec.contextBlocks.find(b => b.id === 'training.workout_overview')?.version).toBe('v1');
    }
  });

  it('training: v12 prompt + workout_overview v2 with the flag on', () => {
    const spec = trainingSpecOf(ON);
    expect(spec.prompt.current.version).toBe('v12');
    expect(spec.contextBlocks.find(b => b.id === 'training.workout_overview')?.version).toBe('v2');
  });

  it('session_planning: v4 prompt + active_plan v1 with the flag off or absent', () => {
    for (const overrides of [{}, { loadPlanPlannerRebind: false }]) {
      const spec = planningSpecOf(overrides);
      expect(spec.prompt.current.version).toBe('v4');
      expect(spec.contextBlocks.find(b => b.id === 'session_planning.active_plan')?.version).toBe('v1');
    }
  });

  it('session_planning: v5 prompt + active_plan v2 with the flag on', () => {
    const spec = planningSpecOf(ON);
    expect(spec.prompt.current.version).toBe('v5');
    expect(spec.contextBlocks.find(b => b.id === 'session_planning.active_plan')?.version).toBe('v2');
  });

  it('planner tool schemas: targetWeight present off/absent, dropped with the flag on', () => {
    type Shape = { shape: Record<string, unknown> };
    const saveExerciseShape = (spec: ReturnType<typeof planCreationSpecOf>): Record<string, unknown> =>
      (
        spec.tools.find(t => t.name === 'save_workout_plan') as unknown as {
          schema: { shape: { sessionTemplates: { element: { shape: { exercises: { element: Shape } } } } } };
        }
      ).schema.shape.sessionTemplates.element.shape.exercises.element.shape;
    const startExerciseShape = (spec: ReturnType<typeof planningSpecOf>): Record<string, unknown> =>
      (
        spec.tools.find(t => t.name === 'start_training_session') as unknown as {
          schema: { shape: { exercises: { element: Shape } } };
        }
      ).schema.shape.exercises.element.shape;

    for (const overrides of [{}, { loadPlanPlannerRebind: false }]) {
      expect(saveExerciseShape(planCreationSpecOf(overrides))).toHaveProperty('targetWeight');
      expect(startExerciseShape(planningSpecOf(overrides))).toHaveProperty('targetWeight');
    }
    const on = ON;
    expect(saveExerciseShape(planCreationSpecOf(on))).not.toHaveProperty('targetWeight');
    expect(startExerciseShape(planningSpecOf(on))).not.toHaveProperty('targetWeight');
  });
});
