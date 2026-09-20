/**
 * The course-check step (course-check plan Task 1, AC-FL-5): one extra
 * structured model call on its own profile, fired by event from prepare —
 * the directive is persisted in state and reused while its fingerprint
 * holds. The call-count assertions are the heart of the suite: a normal turn
 * must make ZERO model calls for this layer; a failure must never block the
 * run. The gateway is always a mock — no real provider call anywhere here.
 */
import type { RunnableConfig } from '@langchain/core/runnables';
import { ZodError } from 'zod';

import type { LlmGateway } from '@domain/ai/ports';
import type { ITrainingService } from '@domain/training/ports';
import type { IUserFactsService, UserFact } from '@domain/user/ports';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

// The warn line is part of the AC ("a failed or malformed call ... logs a warn"):
// one shared mock, same pattern as agent.node.unit.test.ts.
jest.mock('@shared/logger', () => {
  const fns = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => fns, __logFns: fns };
});
const { __logFns: logFns } = jest.requireMock('@shared/logger') as {
  __logFns: { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };
};

import type { ConversationStateType } from '../../graph/state';
import { buildCourseCheckStep, type CourseCheckStepDeps } from '../course-check.step';
import type { CourseCheckDirective, StoredCourseDirective } from '../directive';
import { courseCheckFingerprint } from '../fingerprint';

const NOW = new Date('2026-09-21T12:00:00Z');
const RUN_ID = 'run-2';
const USER_ID = 'u1';
const GAP_MS = 3 * 3_600_000;
const COOLDOWN_MS = 15 * 60_000;
const PLAN_ID = 'plan-1';

const DIRECTIVE: CourseCheckDirective = {
  vector: 'Build muscle 3×/week, upper/lower split',
  constraints: ['Left shoulder: no heavy overhead pressing'],
  questions: ['How does the shoulder feel today?'],
  suspectFacts: ['Sleep quality fact is 10 days old'],
  exerciseVerdicts: [],
};

function fact(overrides: Partial<UserFact> = {}): UserFact {
  return {
    id: 'f1',
    userId: USER_ID,
    category: 'physical_constraint',
    fact: 'Left shoulder aches when pressing',
    factKey: 'left shoulder aches when pressing',
    muscleGroup: 'shoulders_front',
    confirmations: 2,
    sourceTurnId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-10T00:00:00Z'),
    durability: 'long_term',
    expiresAt: null,
    reviewAfter: new Date('2026-09-25T00:00:00Z'),
    phaseNote: 'tweaked three weeks ago',
    phaseAt: new Date('2026-09-01T00:00:00Z'),
    onExpiry: null,
    status: 'active',
    archivedAt: null,
    archivedReason: null,
    closedByUserAt: null,
    supersedesId: null,
    context: null,
    ...overrides,
  };
}

function state(overrides: Partial<ConversationStateType> = {}): ConversationStateType {
  return {
    phase: 'chat',
    activeSessionId: null,
    messages: [],
    pendingTransition: null,
    episodeSummaries: [],
    episodeId: 'run-1',
    episodeStartedAt: '2026-09-21T08:00:00Z',
    lastUserMessageAt: new Date(NOW.getTime() - 3_600_000).toISOString(), // ordinary cadence
    compactReason: null,
    courseDirective: null,
    courseCheckFailure: null,
    ...overrides,
  };
}

function ctxConfig(now = NOW): RunnableConfig {
  return {
    configurable: { thread_id: USER_ID },
    context: {
      runId: RUN_ID,
      userId: USER_ID,
      user: { id: USER_ID, languageCode: 'ru', timezone: null, fitnessGoal: 'Build muscle 3×/week' } as never,
      now,
      client: 'telegram' as const,
      trigger: 'user_message' as const,
      metrics: new RunMetricsCollector(RUN_ID),
    },
  } as never;
}

interface DepsOverrides {
  facts?: UserFact[];
  /** Active short facts past their TTL — what the port's getExpiredActive returns. */
  expired?: UserFact[];
  archiveExpired?: (userId: string, factId: string, now: Date) => Promise<boolean>;
  stored?: StoredCourseDirective | null;
  structured?: (schema: unknown, messages: unknown[]) => Promise<CourseCheckDirective>;
  enabled?: boolean;
}

function makeDeps(overrides: DepsOverrides = {}): CourseCheckStepDeps {
  const structured = overrides.structured ?? (() => Promise.resolve(DIRECTIVE));
  return {
    llmGateway: {
      structured: jest.fn((schema: unknown, messages: unknown[]) => structured(schema, messages)),
    } as unknown as LlmGateway,
    userFacts: {
      getForPrompt: jest.fn(() => Promise.resolve(overrides.facts ?? [fact()])),
      getExpiredActive: jest.fn(() => Promise.resolve(overrides.expired ?? [])),
      archiveExpired: jest.fn(overrides.archiveExpired ?? (() => Promise.resolve(true))),
    } as unknown as IUserFactsService,
    trainingService: {
      getActivePlan: jest.fn(() => Promise.resolve({ id: PLAN_ID })),
    } as unknown as ITrainingService,
    config: { enabled: overrides.enabled ?? true, gapMs: GAP_MS, retryCooldownMs: COOLDOWN_MS },
  };
}

/** The fingerprint the step must compute for the default deps + a given state. */
function expectedFingerprint(
  facts: UserFact[],
  phase: ConversationStateType['phase'],
  activePlanId: string | null = PLAN_ID,
): string {
  return courseCheckFingerprint({
    facts,
    goal: 'Build muscle 3×/week',
    phase,
    activePlanId,
    now: NOW,
  });
}

/** Carry a step's updates into the next run's state — what the checkpointer does between runs. */
function carry(prev: ConversationStateType, updates: Partial<ConversationStateType>): ConversationStateType {
  return { ...prev, ...updates };
}

/** A stored directive that matches the default deps + state exactly (fingerprint holds). */
function storedFor(facts: UserFact[], phase: ConversationStateType['phase'] = 'chat'): StoredCourseDirective {
  return {
    fingerprint: expectedFingerprint(facts, phase),
    directive: DIRECTIVE,
    generatedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
  };
}

describe('buildCourseCheckStep (AC-FL-5)', () => {
  beforeEach(() => {
    Object.values(logFns).forEach(fn => fn.mockClear());
  });

  it('no stored directive → fires once, on the course_check profile, and persists fingerprinted state', async () => {
    const deps = makeDeps();
    const step = buildCourseCheckStep(deps);

    const updates = await step(state(), ctxConfig());

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    const call = (deps.llmGateway.structured as jest.Mock).mock.calls[0] as unknown[];
    const opts = call[2] as { profile: string };
    expect(opts.profile).toBe('course_check');
    expect(updates.courseDirective).toEqual({
      fingerprint: expectedFingerprint([fact()], 'chat'),
      directive: DIRECTIVE,
      generatedAt: NOW.toISOString(),
    });
  });

  it('stable fingerprint, ordinary cadence → ZERO model calls and no state change', async () => {
    const facts = [fact()];
    const stored: StoredCourseDirective = {
      fingerprint: expectedFingerprint(facts, 'chat'),
      directive: DIRECTIVE,
      generatedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    };
    const deps = makeDeps({ facts, stored });
    const step = buildCourseCheckStep(deps);

    const updates = await step(state({ courseDirective: stored }), ctxConfig());

    expect(deps.llmGateway.structured).not.toHaveBeenCalled();
    expect(updates).toEqual({});
  });

  it('a changed fact set refires — the directive is replaced, not merged', async () => {
    const facts = [fact()];
    const stored: StoredCourseDirective = {
      fingerprint: expectedFingerprint(facts, 'chat'),
      directive: DIRECTIVE,
      generatedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    };
    const newFacts = [fact(), fact({ id: 'f2', factKey: 'k2', fact: 'Trains at home', category: 'equipment' })];
    const deps = makeDeps({ facts: newFacts, stored });
    const step = buildCourseCheckStep(deps);

    const updates = await step(state({ courseDirective: stored }), ctxConfig());

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    expect(updates.courseDirective?.fingerprint).toBe(expectedFingerprint(newFacts, 'chat'));
  });

  it('a long gap refires even with a stable fingerprint', async () => {
    const facts = [fact()];
    const stored: StoredCourseDirective = {
      fingerprint: expectedFingerprint(facts, 'chat'),
      directive: DIRECTIVE,
      generatedAt: new Date('2026-09-18T12:00:00Z').toISOString(),
    };
    const deps = makeDeps({ facts, stored });
    const step = buildCourseCheckStep(deps);

    const updates = await step(
      state({ courseDirective: stored, lastUserMessageAt: new Date('2026-09-20T12:00:00Z').toISOString() }),
      ctxConfig(),
    );

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    expect(updates.courseDirective?.generatedAt).toBe(NOW.toISOString());
  });

  it('a failed call leaves the run untouched (warn logged, stored directive survives)', async () => {
    const facts = [fact()];
    const stored: StoredCourseDirective = {
      fingerprint: 'stale-fp',
      directive: DIRECTIVE,
      generatedAt: '2026-09-18T12:00:00Z',
    };
    const deps = makeDeps({
      facts,
      stored,
      structured: () => Promise.reject(new Error('provider down')),
    });
    const step = buildCourseCheckStep(deps);

    const updates = await step(state({ courseDirective: stored }), ctxConfig());

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    expect(updates).toEqual({
      courseCheckFailure: { fingerprint: expectedFingerprint([fact()], 'chat'), at: NOW.toISOString() },
    });
    expect(logFns.warn).toHaveBeenCalledTimes(1);
    expect(logFns.warn.mock.calls[0]?.[1]).toMatch(/failed/i);
  });

  it('a malformed answer (schema-invalid) also leaves the run untouched', async () => {
    const deps = makeDeps({
      structured: () =>
        Promise.reject(
          new ZodError([{ code: 'invalid_type', path: ['vector'], message: 'Required', expected: 'string' }] as never),
        ),
    });
    const step = buildCourseCheckStep(deps);

    const updates = await step(state(), ctxConfig());

    expect(updates).toEqual({
      courseCheckFailure: { fingerprint: expectedFingerprint([fact()], 'chat'), at: NOW.toISOString() },
    });
    expect(logFns.warn).toHaveBeenCalledTimes(1);
  });

  it('a gateway that RESOLVES an invalid shape (a degraded stub) leaves the run untouched too', async () => {
    const deps = makeDeps({
      // Not a directive — e.g. a stub configured for another schema.
      structured: () => Promise.resolve({ topics: [] } as never),
    });
    const step = buildCourseCheckStep(deps);

    const updates = await step(state(), ctxConfig());

    expect(updates).toEqual({
      courseCheckFailure: { fingerprint: expectedFingerprint([fact()], 'chat'), at: NOW.toISOString() },
    });
    expect(logFns.warn).toHaveBeenCalledTimes(1);
    expect(logFns.warn.mock.calls[0]?.[1]).toMatch(/malformed/i);
  });

  it('the layer switched off makes no calls and clears a stored directive once', async () => {
    const deps = makeDeps({ enabled: false });
    const step = buildCourseCheckStep(deps);

    const clears = await step(
      state({ courseDirective: { fingerprint: 'x', directive: DIRECTIVE, generatedAt: NOW.toISOString() } }),
      ctxConfig(),
    );
    expect(clears).toEqual({ courseDirective: null, courseCheckFailure: null });
    expect(deps.llmGateway.structured).not.toHaveBeenCalled();

    const stays = await step(state(), ctxConfig());
    expect(stays).toEqual({});
    expect(deps.llmGateway.structured).not.toHaveBeenCalled();
  });

  it('a failed facts or plan load degrades to what is known — the check still runs', async () => {
    const deps = makeDeps();
    (deps.userFacts.getForPrompt as jest.Mock).mockRejectedValue(new Error('db down'));
    (deps.trainingService.getActivePlan as jest.Mock).mockRejectedValue(new Error('db down'));
    const step = buildCourseCheckStep(deps);

    const updates = await step(state(), ctxConfig());

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    expect(updates.courseDirective?.fingerprint).toBe(expectedFingerprint([], 'chat', null));
  });

  // --- The named events, and nothing else (the cost contract) ---

  it('entering planning refires: a phase change with everything else stable is one call', async () => {
    const facts = [fact()];
    const stored = storedFor(facts, 'chat');
    const deps = makeDeps({ facts });
    const step = buildCourseCheckStep(deps);

    const updates = await step(state({ phase: 'plan_creation', courseDirective: stored }), ctxConfig());

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    expect(updates.courseDirective?.fingerprint).toBe(expectedFingerprint(facts, 'plan_creation'));
  });

  it('a durable write refires: the active plan appearing (or changing) is one call', async () => {
    const facts = [fact()];
    const stored = { ...storedFor(facts), fingerprint: expectedFingerprint(facts, 'chat', null) }; // stored before any plan
    const deps = makeDeps({ facts }); // getActivePlan → PLAN_ID
    const step = buildCourseCheckStep(deps);

    const updates = await step(state({ courseDirective: stored }), ctxConfig());

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    expect(updates.courseDirective?.fingerprint).toBe(expectedFingerprint(facts, 'chat', PLAN_ID));
  });

  it('a changed goal refires', async () => {
    const facts = [fact()];
    const stored = storedFor(facts);
    const deps = makeDeps({ facts });
    const step = buildCourseCheckStep(deps);
    const config = ctxConfig();
    (config as unknown as { context: { user: { fitnessGoal: string } } }).context.user.fitnessGoal =
      'Cut fat for summer';

    await step(state({ courseDirective: stored }), config);

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
  });

  it('a fact corrected in place (same id, new text) refires — the stale directive does not outlive it', async () => {
    const stored = storedFor([fact()]);
    const corrected = fact({ fact: 'Left shoulder is fine now, only stiff in the morning' });
    const deps = makeDeps({ facts: [corrected] });
    const step = buildCourseCheckStep(deps);

    const updates = await step(state({ courseDirective: stored }), ctxConfig());

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    expect(updates.courseDirective?.fingerprint).toBe(expectedFingerprint([corrected], 'chat'));
  });

  it('a long-term review date arriving between runs refires (REVIEW DUE reaches the coach)', async () => {
    const dueAt = new Date('2026-09-21T11:00:00Z'); // NOW is 12:00
    const notYetDue = new Date('2026-09-21T10:00:00Z');
    const facts = [fact({ reviewAfter: dueAt })];
    // Stored when the review date had not arrived yet: same fact, same dates.
    const stored: StoredCourseDirective = {
      fingerprint: courseCheckFingerprint({
        facts,
        goal: 'Build muscle 3×/week',
        phase: 'chat',
        activePlanId: PLAN_ID,
        now: notYetDue,
      }),
      directive: DIRECTIVE,
      generatedAt: notYetDue.toISOString(),
    };
    const deps = makeDeps({ facts });
    const step = buildCourseCheckStep(deps);

    await step(state({ courseDirective: stored }), ctxConfig());

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
  });

  it('nothing else fires it: a confirmation bump / updatedAt touch on a stable set → zero calls', async () => {
    const stored = storedFor([fact()]);
    const touched = fact({ confirmations: 9, updatedAt: new Date('2026-09-21T11:59:00Z') });
    const deps = makeDeps({ facts: [touched] });
    const step = buildCourseCheckStep(deps);

    const updates = await step(state({ courseDirective: stored }), ctxConfig());

    expect(deps.llmGateway.structured).not.toHaveBeenCalled();
    expect(updates).toEqual({});
  });

  it('a run of ordinary turns over one stored directive costs zero calls in total', async () => {
    const facts = [fact()];
    const deps = makeDeps({ facts });
    const step = buildCourseCheckStep(deps);
    let current = state();

    // Turn 1 establishes the directive (the one call) …
    current = { ...current, ...(await step(current, ctxConfig())) };
    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);

    // … turns 2..6, an hour apart on the same inputs, never call again.
    for (let i = 0; i < 5; i++) {
      current = { ...current, ...(await step(current, ctxConfig())) };
    }
    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    expect(current.courseDirective?.directive).toEqual(DIRECTIVE);
  });

  // --- Back-off: a provider outage gets quieter, not chattier ---

  it('a failed call followed by N ordinary turns on the same fingerprint issues exactly ONE model call', async () => {
    const stored = storedFor([fact()]);
    const newFacts = [fact(), fact({ id: 'f2', factKey: 'k2', fact: 'Trains at home', category: 'equipment' })];
    const deps = makeDeps({ facts: newFacts, structured: () => Promise.reject(new Error('provider down')) });
    const step = buildCourseCheckStep(deps);
    let current = state({ courseDirective: stored });

    current = carry(current, await step(current, ctxConfig())); // the one failed attempt
    expect(current.courseCheckFailure).toEqual({
      fingerprint: expectedFingerprint(newFacts, 'chat'),
      at: NOW.toISOString(),
    });
    for (let i = 1; i <= 6; i++) {
      // ordinary turns, a few minutes apart, all inside the cooldown
      const updates = await step(current, ctxConfig(new Date(NOW.getTime() + i * 60_000)));
      expect(updates).toEqual({});
      current = carry(current, updates);
    }

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    expect(logFns.warn).toHaveBeenCalledTimes(1);
    // The previously stored directive was never touched — it keeps rendering.
    expect(current.courseDirective).toEqual(stored);
  });

  it('after the cooldown elapses the same fingerprint retries once — and a success clears the failure', async () => {
    const stored = storedFor([fact()]);
    const newFacts = [fact(), fact({ id: 'f2', factKey: 'k2', fact: 'Trains at home', category: 'equipment' })];
    const structured = jest
      .fn<Promise<CourseCheckDirective>, [unknown, unknown[]]>()
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce(DIRECTIVE);
    const deps = makeDeps({ facts: newFacts, structured });
    const step = buildCourseCheckStep(deps);
    let current = state({ courseDirective: stored });

    current = carry(current, await step(current, ctxConfig()));
    expect(structured).toHaveBeenCalledTimes(1);

    // One millisecond before the cooldown ends: still quiet.
    const almost = new Date(NOW.getTime() + COOLDOWN_MS - 1);
    expect(await step(current, ctxConfig(almost))).toEqual({});
    expect(structured).toHaveBeenCalledTimes(1);

    // At the cooldown: one retry, which succeeds and settles everything.
    const later = new Date(NOW.getTime() + COOLDOWN_MS);
    const retried = await step(current, ctxConfig(later));
    expect(structured).toHaveBeenCalledTimes(2);
    expect(retried.courseDirective?.directive).toEqual(DIRECTIVE);
    expect(retried.courseCheckFailure).toBeNull();
  });

  it('a retry that fails again restarts the cooldown from the new failure', async () => {
    const stored = storedFor([fact()]);
    const newFacts = [fact(), fact({ id: 'f2', factKey: 'k2', fact: 'Trains at home', category: 'equipment' })];
    const deps = makeDeps({ facts: newFacts, structured: () => Promise.reject(new Error('provider down')) });
    const step = buildCourseCheckStep(deps);
    let current = state({ courseDirective: stored });

    current = carry(current, await step(current, ctxConfig()));
    const retryAt = new Date(NOW.getTime() + COOLDOWN_MS);
    current = carry(current, await step(current, ctxConfig(retryAt)));
    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(2);
    expect(current.courseCheckFailure?.at).toBe(retryAt.toISOString());

    // Half a cooldown after the SECOND failure: quiet again.
    const updates = await step(current, ctxConfig(new Date(retryAt.getTime() + COOLDOWN_MS / 2)));
    expect(updates).toEqual({});
    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(2);
  });

  it('a NEW fingerprint during the cooldown fires immediately — the cooldown covers only the one that failed', async () => {
    const stored = storedFor([fact()]);
    const failedFacts = [fact(), fact({ id: 'f2', factKey: 'k2', fact: 'Trains at home', category: 'equipment' })];
    const movedFacts = [...failedFacts, fact({ id: 'f3', factKey: 'k3', fact: 'No barbell', category: 'equipment' })];
    const deps = makeDeps({ facts: failedFacts, structured: () => Promise.reject(new Error('provider down')) });
    const step = buildCourseCheckStep(deps);
    let current = state({ courseDirective: stored });
    current = carry(current, await step(current, ctxConfig()));
    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);

    // The inputs moved again one minute later — well inside the cooldown.
    (deps.userFacts.getForPrompt as jest.Mock).mockResolvedValue(movedFacts);
    (deps.llmGateway.structured as jest.Mock).mockResolvedValueOnce(DIRECTIVE);
    const updates = await step(current, ctxConfig(new Date(NOW.getTime() + 60_000)));

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(2);
    expect(updates.courseDirective?.fingerprint).toBe(
      courseCheckFingerprint({
        facts: movedFacts,
        goal: 'Build muscle 3×/week',
        phase: 'chat',
        activePlanId: PLAN_ID,
        now: new Date(NOW.getTime() + 60_000),
      }),
    );
  });

  it('a malformed answer backs off exactly like a thrown error', async () => {
    const stored = storedFor([fact()]);
    const newFacts = [fact(), fact({ id: 'f2', factKey: 'k2', fact: 'Trains at home', category: 'equipment' })];
    const deps = makeDeps({ facts: newFacts, structured: () => Promise.resolve({ topics: [] } as never) });
    const step = buildCourseCheckStep(deps);
    let current = state({ courseDirective: stored });

    current = carry(current, await step(current, ctxConfig()));
    await step(current, ctxConfig(new Date(NOW.getTime() + 60_000)));
    await step(current, ctxConfig(new Date(NOW.getTime() + 120_000)));

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
  });

  it('switching the layer off clears a remembered failure along with the directive', async () => {
    const deps = makeDeps({ enabled: false });
    const step = buildCourseCheckStep(deps);

    const updates = await step(state({ courseCheckFailure: { fingerprint: 'x', at: NOW.toISOString() } }), ctxConfig());

    expect(updates).toEqual({ courseDirective: null, courseCheckFailure: null });
  });

  it('a failed long-gap call leaves a stable-fingerprint directive in place', async () => {
    const facts = [fact()];
    const stored = storedFor(facts);
    const deps = makeDeps({ facts, structured: () => Promise.reject(new Error('provider down')) });
    const step = buildCourseCheckStep(deps);

    const updates = await step(
      state({ courseDirective: stored, lastUserMessageAt: new Date('2026-09-20T12:00:00Z').toISOString() }),
      ctxConfig(),
    );

    expect(updates).toEqual({
      courseCheckFailure: { fingerprint: expectedFingerprint([fact()], 'chat'), at: NOW.toISOString() },
    });
    expect(logFns.warn).toHaveBeenCalledTimes(1);
  });

  it('sends the check prompt as one system + one user message with the schema name', async () => {
    const deps = makeDeps();
    const step = buildCourseCheckStep(deps);

    await step(state({ phase: 'plan_creation' }), ctxConfig());

    const [schema, messages, opts] = (deps.llmGateway.structured as jest.Mock).mock.calls[0] as [
      { shape: unknown },
      Array<{ role: string; content: string }>,
      { schemaName: string },
    ];
    expect(schema).toBeDefined();
    expect(opts.schemaName).toBe('course_check_directive_v1');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    // The user message carries the run's state: phase, goal, the facts, the plan.
    expect(messages[1].content).toContain('plan_creation');
    expect(messages[1].content).toContain('Build muscle 3×/week');
    expect(messages[1].content).toContain('Left shoulder aches when pressing');
    expect(messages[1].content).toContain(PLAN_ID);
  });
});

// --- Expiry, performed (AC-FL-1, AC-FL-5): ask_once is asked once, forget is archived silently ---

describe('buildCourseCheckStep — expiry is performed', () => {
  beforeEach(() => {
    Object.values(logFns).forEach(fn => fn.mockClear());
  });

  const DAY = 86_400_000;
  /** An expired short fact, TTL ran out two days before NOW. */
  const shortFact = (overrides: Partial<UserFact> = {}): UserFact =>
    fact({
      id: 'short-1',
      category: 'physical_constraint',
      fact: 'Left shoulder tweaked while pressing',
      factKey: 'left shoulder tweaked while pressing',
      durability: 'short',
      reviewAfter: null,
      phaseNote: null,
      phaseAt: null,
      expiresAt: new Date(NOW.getTime() - 2 * DAY),
      onExpiry: 'ask_once',
      ...overrides,
    });
  const doms = (overrides: Partial<UserFact> = {}): UserFact =>
    shortFact({
      id: 'short-2',
      category: 'physiological_pattern',
      fact: 'Legs sore after squats',
      factKey: 'legs sore after squats',
      muscleGroup: null,
      onExpiry: 'forget',
      ...overrides,
    });

  const archivedIds = (deps: CourseCheckStepDeps): string[] =>
    (deps.userFacts.archiveExpired as jest.Mock).mock.calls.map(c => c[1] as string);
  const checkInput = (deps: CourseCheckStepDeps): string =>
    ((deps.llmGateway.structured as jest.Mock).mock.calls[0]![1] as Array<{ content: string }>)
      .map(m => m.content)
      .join('\n');

  it('an expired ask_once fact reaches the check input marked for ONE question, and is archived after the directive', async () => {
    const deps = makeDeps({ expired: [shortFact()] });
    const step = buildCourseCheckStep(deps);

    const updates = await step(state(), ctxConfig());

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    const input = checkInput(deps);
    expect(input).toContain('Left shoulder tweaked while pressing');
    // The per-fact line (the bare marker also appears in the check's own instructions).
    expect(input).toContain('Left shoulder tweaked while pressing (physical_constraint, expired 2 day(s) ago)');
    expect(updates.courseDirective?.directive).toEqual(DIRECTIVE);
    expect(archivedIds(deps)).toEqual(['short-1']);
    // Archived AFTER the call, with the run clock: the question is never lost to a failed call.
    const [structuredOrder] = (deps.llmGateway.structured as jest.Mock).mock.invocationCallOrder;
    const [archiveOrder] = (deps.userFacts.archiveExpired as jest.Mock).mock.invocationCallOrder;
    expect(archiveOrder).toBeGreaterThan(structuredOrder!);
    expect((deps.userFacts.archiveExpired as jest.Mock).mock.calls[0]).toEqual([USER_ID, 'short-1', NOW]);
  });

  it('asked exactly ONCE: the next runs find nothing due, and the stored fingerprint is the SETTLED one — no refire', async () => {
    // The port drops the fact from the due list once archived (the real repository does).
    const due = [shortFact()];
    const deps = makeDeps({
      expired: due,
      archiveExpired: async (_u, id) => {
        due.splice(0, due.length, ...due.filter(f => f.id !== id));
        return true;
      },
    });
    const step = buildCourseCheckStep(deps);
    let current = state();

    current = carry(current, await step(current, ctxConfig()));
    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    // Stored hash == the hash of the steady state (nothing due): what the next run recomputes.
    expect(current.courseDirective?.fingerprint).toBe(expectedFingerprint([fact()], 'chat'));

    for (let i = 1; i <= 5; i++) {
      const updates = await step(current, ctxConfig(new Date(NOW.getTime() + i * 60_000)));
      expect(updates).toEqual({});
      current = carry(current, updates);
    }

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1); // the fingerprint is stable turn to turn
    expect(archivedIds(deps)).toEqual(['short-1']); // archived once
  });

  it('a fact becoming due refires the check even when nothing else moved (it expired while an earlier directive already excluded it)', async () => {
    // The stored hash is the steady state: facts as they are NOW (the expired fact long gone from them).
    const facts = [fact()];
    const stored = storedFor(facts);
    const deps = makeDeps({ facts, expired: [shortFact()] });
    const step = buildCourseCheckStep(deps);

    const updates = await step(state({ courseDirective: stored }), ctxConfig());

    expect(deps.llmGateway.structured).toHaveBeenCalledTimes(1);
    expect(archivedIds(deps)).toEqual(['short-1']);
    expect(updates.courseDirective?.fingerprint).toBe(stored.fingerprint); // settled: back to the steady state
  });

  it('an expired forget fact is archived silently: no question, no prompt line, no model call of its own', async () => {
    const facts = [fact()];
    const deps = makeDeps({ facts, expired: [doms()] });
    const stored = storedFor(facts);
    const step = buildCourseCheckStep(deps);

    const updates = await step(state({ courseDirective: stored }), ctxConfig());

    expect(archivedIds(deps)).toEqual(['short-2']);
    expect(deps.llmGateway.structured).not.toHaveBeenCalled(); // nothing else moved: it does not fire the check
    expect(updates).toEqual({});
  });

  it('a forget fact never appears in a check that fires for another reason', async () => {
    const deps = makeDeps({ expired: [doms(), shortFact()] });
    const step = buildCourseCheckStep(deps);

    await step(state(), ctxConfig());

    const input = checkInput(deps);
    expect(input).not.toContain('Legs sore after squats');
    expect(input).toContain('Left shoulder tweaked while pressing');
    expect(archivedIds(deps).sort()).toEqual(['short-1', 'short-2']);
  });

  it('a fact that is not expired, or is not active, is untouched (the predicate decides, not the port)', async () => {
    const notYet = shortFact({ id: 'live', expiresAt: new Date(NOW.getTime() + DAY) });
    const closed = shortFact({ id: 'closed', status: 'archived', archivedReason: 'user_closed', archivedAt: NOW });
    const longTerm = fact({ id: 'long' }); // durability long_term: never expires
    const deps = makeDeps({ expired: [notYet, closed, longTerm] });
    const step = buildCourseCheckStep(deps);

    await step(state(), ctxConfig());

    expect(deps.userFacts.archiveExpired).not.toHaveBeenCalled();
    expect(checkInput(deps)).not.toContain('day(s) ago');
  });

  it('a failed archive never fails or blocks the run: the directive is still produced, an error is logged', async () => {
    const deps = makeDeps({
      expired: [shortFact(), doms()],
      archiveExpired: () => Promise.reject(new Error('db down')),
    });
    const step = buildCourseCheckStep(deps);

    const updates = await step(state(), ctxConfig());

    expect(updates.courseDirective?.directive).toEqual(DIRECTIVE);
    expect(deps.userFacts.archiveExpired).toHaveBeenCalledTimes(2); // one failure does not stop the batch
    expect(logFns.error).toHaveBeenCalledTimes(2);
  });

  it('a failed due-read degrades to no expiry this run — the check still runs on the rest', async () => {
    const deps = makeDeps();
    (deps.userFacts.getExpiredActive as jest.Mock).mockRejectedValue(new Error('db down'));
    const step = buildCourseCheckStep(deps);

    const updates = await step(state(), ctxConfig());

    expect(updates.courseDirective?.directive).toEqual(DIRECTIVE);
    expect(deps.userFacts.archiveExpired).not.toHaveBeenCalled();
  });

  it('a FAILED check leaves the ask_once fact unarchived (still owed), backs off, and asks after the cooldown', async () => {
    const due = [shortFact()];
    const structured = jest
      .fn<Promise<CourseCheckDirective>, [unknown, unknown[]]>()
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce(DIRECTIVE);
    const deps = makeDeps({
      expired: due,
      structured,
      archiveExpired: async (_u, id) => {
        due.splice(0, due.length, ...due.filter(f => f.id !== id));
        return true;
      },
    });
    const step = buildCourseCheckStep(deps);
    let current = state();

    current = carry(current, await step(current, ctxConfig()));
    expect(deps.userFacts.archiveExpired).not.toHaveBeenCalled();
    expect(current.courseCheckFailure).not.toBeNull();

    // Inside the cooldown: quiet, and still owed.
    await step(current, ctxConfig(new Date(NOW.getTime() + 60_000)));
    expect(structured).toHaveBeenCalledTimes(1);
    expect(deps.userFacts.archiveExpired).not.toHaveBeenCalled();

    // After it: the one question is asked and only then is the fact archived.
    const retried = await step(current, ctxConfig(new Date(NOW.getTime() + COOLDOWN_MS)));
    expect(structured).toHaveBeenCalledTimes(2);
    expect(retried.courseDirective).toBeDefined();
    expect(archivedIds(deps)).toEqual(['short-1']);
  });

  it('with the layer OFF nobody can ask: both kinds are archived, still no model call', async () => {
    const deps = makeDeps({ enabled: false, expired: [shortFact(), doms()] });
    const step = buildCourseCheckStep(deps);

    await step(state(), ctxConfig());

    expect(archivedIds(deps).sort()).toEqual(['short-1', 'short-2']);
    expect(deps.llmGateway.structured).not.toHaveBeenCalled();
  });
});
