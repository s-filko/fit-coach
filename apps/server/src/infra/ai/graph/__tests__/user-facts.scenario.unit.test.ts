/**
 * AC-1361 (refactor-p6-facts-and-progress-blocks, deterministic half — pinned
 * by the structured-output-fenced-json plan Task 2): the user-facts chain end
 * to end with a mocked model — a lower-back injury stated in an episode is
 * extracted by the summariser answering INSIDE a ```json fence through the
 * REAL `OpenAiLlmGateway.structured()` (BUG-017 recovery, Task 1), upserted
 * into an in-memory `IUserFactsService` stand-in with the real port's
 * semantics, rendered as `## User Facts` ahead of `## Previous episodes` on
 * the next run, and enforced by `start_training_session` (primary-muscle
 * conflict → user_error quoting the fact, nothing persisted; secondary-only
 * → the call goes through). A later compaction restating the same fact
 * confirms it (one row, `confirmations: 2`).
 *
 * The model is stubbed BENEATH the real gateway: `@infra/ai/model.factory` is
 * mocked (chat path scripted for the agent node, structured path answering
 * fenced JSON for `structured()`), exactly like llm.gateway.unit.test.ts does.
 * The graph is the real one, with stubbed ports — same harness as
 * episode-memory.integration.unit.test.ts.
 */
import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';

import type { UpsertFactInput, UserFact, IUserFactsService } from '@domain/user/ports';

import { OpenAiLlmGateway } from '@infra/ai/llm.gateway';
import type { ExerciseWithMuscles } from '@domain/training/types';
import { computeFactKey } from '@domain/user/services/fact-key';
import { isActiveForPrompt } from '@domain/user/services/fact-lifecycle';

import { buildConversationGraph, type ConversationGraphDeps } from '../conversation.graph';
import { USER, ctxConfig } from './graph-test-support';

/** In-memory `IUserFactsService` with the Drizzle port's semantics (D-C/D-G, AC-FL-1). */
class InMemoryUserFactsService implements IUserFactsService {
  readonly rows: UserFact[] = [];
  readonly upsertCalls: Array<{ userId: string; facts: UpsertFactInput[]; sourceTurnId?: string }> = [];
  readonly promptCalls: Array<{ userId: string; now: Date }> = [];

  async upsertMany(userId: string, facts: UpsertFactInput[], sourceTurnId?: string): Promise<number> {
    this.upsertCalls.push({ userId, facts: [...facts], sourceTurnId });
    for (const input of facts) {
      const factKey = computeFactKey(input.fact);
      // D-C: upsert on the unique (userId, category, factKey) — a repeat
      // increments confirmations/updatedAt, never rewrites `fact`.
      const existing = this.rows.find(
        r => r.userId === userId && r.category === input.category && r.factKey === factKey,
      );
      if (existing) {
        existing.confirmations += 1;
        existing.updatedAt = new Date();
      } else {
        this.rows.push({
          id: `fact-${this.rows.length + 1}`,
          userId,
          category: input.category,
          fact: input.fact,
          factKey,
          muscleGroup: input.muscleGroup ?? null,
          confirmations: 1,
          sourceTurnId: sourceTurnId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
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
        });
      }
    }
    return facts.length;
  }

  async getForPrompt(userId: string, now: Date, cap = 50): Promise<UserFact[]> {
    this.promptCalls.push({ userId, now });
    return this.rows.filter(r => r.userId === userId && isActiveForPrompt(r, now)).slice(0, cap);
  }

  async getConstraints(userId: string, now: Date): Promise<UserFact[]> {
    return this.rows.filter(
      r =>
        r.userId === userId &&
        r.category === 'physical_constraint' &&
        r.muscleGroup !== null &&
        isActiveForPrompt(r, now),
    );
  }

  // Task 2's surface, with the repository's semantics — unused by this file's
  // scenarios (mocked models never call the memory tools), but the port demands them.
  async rememberFact(): Promise<never> {
    throw new Error('not used in this scenario');
  }

  async retractFact(): Promise<never> {
    throw new Error('not used in this scenario');
  }

  async deleteFact(): Promise<never> {
    throw new Error('not used in this scenario');
  }

  async listFacts(): Promise<never> {
    throw new Error('not used in this scenario');
  }
}

// The catalog: one exercise whose PRIMARY muscles include lower_back, one
// where lower_back is only secondary (D-G: constraints bind on primary only).
const DEADLIFT_ID = '5b0f8a3e-1111-4111-8111-111111111111';
const SQUAT_ID = '5b0f8a3e-2222-4222-8222-222222222222';

function exerciseWith(
  id: string,
  name: string,
  muscleGroups: ExerciseWithMuscles['muscleGroups'],
): ExerciseWithMuscles {
  return {
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
  };
}

const CATALOG: Record<string, ExerciseWithMuscles> = {
  [DEADLIFT_ID]: exerciseWith(DEADLIFT_ID, 'Barbell Deadlift', [
    { muscleGroup: 'lower_back', involvement: 'primary' },
    { muscleGroup: 'glutes', involvement: 'primary' },
  ]),
  [SQUAT_ID]: exerciseWith(SQUAT_ID, 'Back Squat', [
    { muscleGroup: 'quads', involvement: 'primary' },
    { muscleGroup: 'lower_back', involvement: 'secondary' },
  ]),
};

// The scripted model: chat answers come from a FIFO script (the agent node's
// invoke), structured answers from a FIFO of RAW contents (the real gateway's
// withConfig().invoke — fenced on purpose). Both inputs are recorded.
jest.mock('@infra/ai/model.factory', () => {
  const recorded: BaseMessage[][] = [];
  const script: Array<() => AIMessage> = [];
  const structuredAnswers: string[] = [];
  let structuredCalls = 0;
  const model = {
    bindTools: () => model,
    invoke: async (messages: BaseMessage[]) => {
      recorded.push(messages);
      const next = script.shift();
      return next ? next() : new AIMessage({ content: 'Хорошо.', tool_calls: [] });
    },
    withConfig: () => ({
      invoke: async () => {
        structuredCalls += 1;
        const answer = structuredAnswers.shift();
        if (answer === undefined) {
          throw new Error('No scripted structured answer left');
        }
        return { content: answer };
      },
    }),
  };
  return {
    getModel: () => model,
    __recorded: recorded,
    __script: script,
    __structuredAnswers: structuredAnswers,
    __structuredCalls: () => structuredCalls,
  };
});

const modelFactory = jest.requireMock('@infra/ai/model.factory') as {
  __recorded: BaseMessage[][];
  __script: Array<() => AIMessage>;
  __structuredAnswers: string[];
  __structuredCalls: () => number;
};

/** A valid session recommendation targeting the given exercise. */
function sessionArgs(exerciseId: string): Record<string, unknown> {
  return {
    sessionKey: 'upper_a',
    sessionName: 'Upper A',
    reasoning: 'planned around the constraint',
    exercises: [{ exerciseId, targetSets: 3, targetReps: '8-10', restSeconds: 120 }],
    estimatedDuration: 45,
  };
}

/** A complete EpisodeSummary payload rendered as a ```json fence (BUG-017). */
function fencedSummary(fact: string): string {
  const payload = {
    topics: ['lower back injury discussed'],
    decisions: [],
    userState: ['recovering from a lower back injury'],
    trainingFeedback: [],
    openItems: [],
    facts: [{ category: 'physical_constraint', fact, muscleGroup: 'lower_back' }],
  };
  return `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

const INJURY_MESSAGE = 'У меня травма поясницы, врач запретил нагрузку на низ спины.';

function makeDeps(userFacts: InMemoryUserFactsService): ConversationGraphDeps {
  return {
    trainingService: {
      getTrainingHistory: jest.fn().mockResolvedValue([]),
      getSessionDetails: jest.fn().mockResolvedValue(null),
      completeSession: jest.fn(),
      startSession: jest.fn().mockResolvedValue({ id: 'sess-1', status: 'planning' }),
    } as never,
    workoutPlanRepo: { findActiveByUserId: jest.fn().mockResolvedValue(null) } as never,
    workoutSessionRepo: {
      findRecentByUserIdWithDetails: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    } as never,
    exerciseRepository: {
      searchByEmbedding: jest.fn().mockResolvedValue([]),
      findByIds: jest.fn().mockResolvedValue([]),
      findByIdsWithMuscles: jest.fn(async (ids: string[]) => ids.map(id => CATALOG[id]).filter(Boolean)),
    } as never,
    embeddingService: { embed: jest.fn().mockResolvedValue(new Array(384).fill(0)) } as never,
    userService: {
      getUser: jest.fn().mockResolvedValue(USER),
      updateProfileData: jest.fn(),
      isRegistrationComplete: jest.fn().mockReturnValue(true),
      needsRegistration: jest.fn().mockReturnValue(false),
      upsertUser: jest.fn(),
    } as never,
    transcript: { appendRunMessages: jest.fn(), appendSystemNote: jest.fn() },
    summaries: {
      insert: jest.fn().mockResolvedValue(undefined),
      latestLegacySummary: jest.fn().mockResolvedValue(null),
    },
    userFacts,
    // The REAL gateway — only the ChatModel beneath it is the mock above.
    llmGateway: new OpenAiLlmGateway(),
    runService: { recordRun: jest.fn() } as never,
    // keepTurns 0: the scenario's compactions must fold everything into
    // summaries (the fact pipeline under test) — the tail would defer them.
    episodeConfig: { gapMs: 60_000, minTurns: 0, minTokens: 0, keepTurns: 0 },
    checkpointer: new MemorySaver(),
  } as unknown as ConversationGraphDeps;
}

describe('user-facts scenario end to end (AC-1361, fenced summary → fact → block → tool rejection)', () => {
  it('carries a stated constraint through compaction, facts, prompt and hard validation', async () => {
    const facts = new InMemoryUserFactsService();
    const deps = makeDeps(facts);
    const { insert: summariesInsert } = deps.summaries as unknown as { insert: jest.Mock };
    const { startSession } = deps.trainingService as unknown as { startSession: jest.Mock };
    const graph = buildConversationGraph(deps);

    const T0 = new Date('2026-09-19T10:00:00Z');
    const T1 = new Date(T0.getTime() + 5 * 60_000); // run 2: T1 - T0 ≥ gap → compaction 1
    const T2 = new Date(T1.getTime() + 10_000); // run 3: T2 - T1 < gap → no compaction
    const T3 = new Date(T0.getTime() + 20 * 60_000); // run 4: T3 - T2 ≥ gap → compaction 2

    const FACT_V1 = 'User has a lower back injury — no direct loading of the lower back';
    // Step 5 restates the same fact with different case/terminal punctuation:
    // the D-C key normalises both, so this must CONFIRM, not duplicate.
    const FACT_V2 = 'user has a LOWER BACK injury — no direct loading of the lower back.';

    const { __recorded: recorded, __script: script, __structuredAnswers: structuredAnswers } = modelFactory;
    recorded.length = 0;
    script.length = 0;
    structuredAnswers.length = 0;
    script.push(
      // Run 1 (chat): plain-text reply.
      () => new AIMessage({ content: 'Понял, учту это при планировании.', tool_calls: [] }),
      // Run 2 (chat): plain-text reply.
      () => new AIMessage({ content: 'Спасибо, всё записано.', tool_calls: [] }),
      // Run 3 (session_planning): conflicting call, then safe call, then the
      // final user-facing reply.
      () =>
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 'call-sts-1', name: 'start_training_session', args: sessionArgs(DEADLIFT_ID), type: 'tool_call' },
          ],
        }),
      () =>
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 'call-sts-2', name: 'start_training_session', args: sessionArgs(SQUAT_ID), type: 'tool_call' },
          ],
        }),
      () => new AIMessage({ content: 'Тренировка готова, поясница в безопасности.', tool_calls: [] }),
      // Run 4 (chat): plain-text reply.
      () => new AIMessage({ content: 'Продолжаем.', tool_calls: [] }),
    );
    structuredAnswers.push(fencedSummary(FACT_V1), fencedSummary(FACT_V2));

    // --- Step 1: the user states a lower-back injury in an episode.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage(INJURY_MESSAGE)] },
      ctxConfig({ runId: 'run-1', now: T0 }),
    );
    const run1Input = recorded[0]!;
    expect(run1Input.some(m => m._getType() === 'human' && String(m.content).includes('поясницы'))).toBe(true);

    // --- Step 2: compaction — the summariser answers INSIDE a ```json fence
    // through the REAL gateway; the summary is stored and the fact upserted.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('Спасибо, до связи.')] },
      ctxConfig({ runId: 'run-2', now: T1 }),
    );

    expect(summariesInsert).toHaveBeenCalledTimes(1);
    expect(summariesInsert.mock.calls[0][0]).toMatchObject({
      userId: 'u1',
      structured: {
        facts: [{ category: 'physical_constraint', fact: FACT_V1, muscleGroup: 'lower_back' }],
      },
    });
    // One fact, confirmed once; getConstraints returns the physical_constraint
    // with a non-null muscleGroup (the hard-validation input, D-G).
    expect(facts.rows).toHaveLength(1);
    expect(facts.rows[0]).toMatchObject({
      category: 'physical_constraint',
      muscleGroup: 'lower_back',
      confirmations: 1,
    });
    await expect(facts.getConstraints('u1', T1)).resolves.toHaveLength(1);
    // The fenced answer cost exactly ONE provider call — BUG-017's recovery,
    // not the old blind retry.
    expect(modelFactory.__structuredCalls()).toBe(1);

    // --- Step 3: the next run's assembled model input carries `## User Facts`
    // with the fact, placed BEFORE `## Previous episodes` (D-F ordering).
    await graph.invoke(
      { phase: 'session_planning', messages: [new HumanMessage('Давай тренировку.')] },
      ctxConfig({ runId: 'run-3', now: T2 }),
    );
    const run3FirstInput = recorded[2]! as BaseMessage[];
    const factsBlock = run3FirstInput.find(
      m => m._getType() === 'system' && String(m.content).includes('## User Facts'),
    );
    const episodesBlock = run3FirstInput.find(
      m => m._getType() === 'system' && String(m.content).includes('## Previous episodes'),
    );
    expect(factsBlock).toBeDefined();
    expect(episodesBlock).toBeDefined();
    expect(String(factsBlock!.content)).toContain('lower back injury');
    expect(String(factsBlock!.content)).toContain('(lower_back)');
    expect(run3FirstInput.indexOf(factsBlock!)).toBeLessThan(run3FirstInput.indexOf(episodesBlock!));

    // --- Step 4: hard validation — PRIMARY lower_back is rejected with a
    // user_error quoting the fact (nothing persisted); secondary-only passes.
    const run3SecondInput = recorded[3]! as BaseMessage[];
    const rejection = run3SecondInput.find(
      (m: BaseMessage) => m._getType() === 'tool' && (m as ToolMessage).tool_call_id === 'call-sts-1',
    ) as ToolMessage | undefined;
    expect(rejection).toBeDefined();
    expect(String(rejection!.content)).toContain('Cannot proceed');
    expect(String(rejection!.content)).toContain(FACT_V1);
    // Exactly one write — the safe (secondary-only) call — and it is the
    // squat's recommendation, not the rejected deadlift's.
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(startSession.mock.calls[0][1].sessionPlanJson.exercises).toEqual([
      { exerciseId: SQUAT_ID, targetSets: 3, targetReps: '8-10', restSeconds: 120 },
    ]);
    // The safe call's result reaches the agent on its next loop (recorded[4]).
    const run3ThirdInput = recorded[4]! as BaseMessage[];
    const acceptance = run3ThirdInput.find(
      (m: BaseMessage) => m._getType() === 'tool' && (m as ToolMessage).tool_call_id === 'call-sts-2',
    ) as ToolMessage | undefined;
    expect(String(acceptance!.content)).toContain('Session created (ID: sess-1)');

    // --- Step 5: a later compaction restating the same fact confirms it.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('План отличный.')] },
      ctxConfig({ runId: 'run-4', now: T3 }),
    );

    expect(summariesInsert).toHaveBeenCalledTimes(2);
    expect(facts.upsertCalls).toHaveLength(2);
    expect(facts.rows).toHaveLength(1);
    expect(facts.rows[0]!.confirmations).toBe(2);
    expect(facts.rows[0]!.fact).toBe(FACT_V1); // the stored text is never rewritten (D-C)
    expect(modelFactory.__structuredCalls()).toBe(2);
  });

  it('AC-FL-1: expired and archived facts never reach the prompt; the facts clock is the run clock', async () => {
    const T0 = new Date('2026-09-19T10:00:00Z');
    const facts = new InMemoryUserFactsService();
    const deps = makeDeps(facts);
    const graph = buildConversationGraph(deps);

    const { __recorded: recorded, __script: script, __structuredAnswers: structuredAnswers } = modelFactory;
    recorded.length = 0;
    script.length = 0;
    structuredAnswers.length = 0;
    script.push(() => new AIMessage({ content: 'Продолжаем.', tool_calls: [] }));

    // One live permanent fact, one short fact whose TTL is up, one archived
    // fact — only the live one may render.
    facts.rows.push(
      {
        id: 'live-1',
        userId: 'u1',
        category: 'equipment',
        fact: 'Home dumbbells only',
        factKey: 'home dumbbells only',
        muscleGroup: null,
        confirmations: 2,
        sourceTurnId: null,
        createdAt: new Date('2026-09-01T00:00:00Z'),
        updatedAt: new Date('2026-09-10T00:00:00Z'),
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
      },
      {
        id: 'expired-1',
        userId: 'u1',
        category: 'physiological_pattern',
        fact: 'Sore legs after squats',
        factKey: 'sore legs after squats',
        muscleGroup: null,
        confirmations: 1,
        sourceTurnId: null,
        createdAt: new Date('2026-09-05T00:00:00Z'),
        updatedAt: new Date('2026-09-05T00:00:00Z'),
        durability: 'short',
        expiresAt: new Date(T0.getTime() - 86_400_000), // TTL up a day before the run
        reviewAfter: null,
        phaseNote: null,
        phaseAt: null,
        onExpiry: 'forget',
        status: 'active',
        archivedAt: null,
        archivedReason: null,
        closedByUserAt: null,
        supersedesId: null,
        context: null,
      },
      {
        id: 'archived-1',
        userId: 'u1',
        category: 'physical_constraint',
        fact: 'Old shoulder tweak',
        factKey: 'old shoulder tweak',
        muscleGroup: 'shoulders_front',
        confirmations: 1,
        sourceTurnId: null,
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-20T00:00:00Z'),
        durability: 'short',
        expiresAt: null,
        reviewAfter: null,
        phaseNote: null,
        phaseAt: null,
        onExpiry: 'forget',
        status: 'archived',
        archivedAt: new Date('2026-09-01T00:00:00Z'),
        archivedReason: 'user_closed',
        closedByUserAt: new Date('2026-09-01T00:00:00Z'),
        supersedesId: null,
        context: null,
      },
    );

    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('Что ты помнишь обо мне?')] },
      ctxConfig({ runId: 'run-1', now: T0 }),
    );

    // The facts were loaded against the RUN's clock, not a fresh one.
    expect(facts.promptCalls).toEqual([{ userId: 'u1', now: T0 }]);

    const systemMessages = recorded[0]!.filter(m => m._getType() === 'system').map(m => String(m.content));
    const factsBlock = systemMessages.find(c => c.includes('## User Facts'));
    expect(factsBlock).toBeDefined();
    expect(factsBlock).toContain('Home dumbbells only');
    expect(factsBlock).toContain('2× confirmed'); // AC-FL-1: the confirmation count renders
    expect(factsBlock).not.toContain('Sore legs after squats'); // expired — hidden
    expect(factsBlock).not.toContain('Old shoulder tweak'); // archived — never rendered
  });
});
