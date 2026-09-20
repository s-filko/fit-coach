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
};

/** Minimal deps cast: each loader reads only the services it closes over. */
function stubDeps(overrides: Record<string, unknown> = {}): ConversationGraphDeps {
  return {
    userService: { getUser: async () => ({ id: 'u1' }) },
    workoutPlanRepo: { findActiveByUserId: async () => ({ id: 'plan-1', name: 'Plan' }) },
    workoutSessionRepo: {
      findRecentByUserIdWithDetails: async () => [SESSION_ROW],
      findLastCompletedByUserAndKey: async () => null,
    },
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
  registration: ['save_profile_fields', 'complete_registration', 'save_timezone', 'manage_fact', 'list_facts'],
  chat: ['update_profile', 'request_transition', 'save_timezone', 'manage_fact', 'list_facts'],
  plan_creation: [
    'search_exercises',
    'save_workout_plan',
    'request_transition',
    'save_timezone',
    'manage_fact',
    'list_facts',
  ],
  session_planning: [
    'search_exercises',
    'start_training_session',
    'request_transition',
    'save_timezone',
    'manage_fact',
    'list_facts',
  ],
  training: [
    'search_exercises',
    'log_set',
    'complete_current_exercise',
    'finish_training',
    'delete_last_sets',
    'update_last_set',
    'save_timezone',
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

  it('training carries the executor policy: priority, log_set dedup, budget 1, BUG-008 availability', () => {
    const { toolPolicy } = specOf('training');
    expect(toolPolicy.ordering).toEqual(TRAINING_TOOL_PRIORITY);
    expect(toolPolicy.batchDedup).toEqual(['log_set']);
    expect(toolPolicy.llmErrorBudget).toBe(1);

    // BUG-008 Plan A: with sets on the in-progress exercise, everything is available;
    // on a fresh exercise the set-editing tools are hidden.
    const withSets = { exercises: [{ status: 'in_progress', sets: [{}] }] };
    expect(toolPolicy.availability?.({ data: { session: withSets } })).toBeNull();
    const fresh = { exercises: [{ status: 'in_progress', sets: [] }] };
    expect(toolPolicy.availability?.({ data: { session: fresh } })).toEqual([
      'search_exercises',
      'log_set',
      'complete_current_exercise',
      'finish_training',
      'save_timezone',
      // fact-lifecycle Task 2: memory control is never session-gated.
      'manage_fact',
      'list_facts',
    ]);
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

  it('training loader returns the session and its previous completed sibling (D-M)', async () => {
    const previous = { id: 'session-0', sessionKey: 'Upper A' };
    const deps = stubDeps({ workoutSessionRepo: { findLastCompletedByUserAndKey: async () => previous } });
    const loaded = await specOf('training').loadContext(
      { userId: 'u1', user: null, activeSessionId: 'session-1' },
      deps,
    );
    expect(loaded).toEqual({
      ok: true,
      data: { session: SESSION_ROW, previousSession: previous },
    });
  });
});
