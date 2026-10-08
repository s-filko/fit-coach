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

import type {
  FactsListing,
  IUserFactsService,
  RememberFactInput,
  RememberFactOutcome,
  SupersedeFactInput,
  UserFact,
} from '@domain/user/ports';

import { OpenAiLlmGateway } from '@infra/ai/llm.gateway';
import { textOnly } from '@infra/ai/message-text';
import type { ExerciseWithMuscles } from '@domain/training/types';
import { computeFactKey } from '@domain/user/services/fact-key';
import { closureMoment, isActiveForPrompt, isExpired } from '@domain/user/services/fact-lifecycle';

import { buildConversationGraph, type ConversationGraphDeps } from '../conversation.graph';
import { USER, ctxConfig } from './graph-test-support';

/**
 * In-memory `IUserFactsService` with the Drizzle port's semantics (D-C/D-G,
 * AC-FL-1..4) — including the two-clock AC-FL-3 guard: a user-closed key is
 * only re-created from evidence NEWER than the closure.
 */
class InMemoryUserFactsService implements IUserFactsService {
  readonly rows: UserFact[] = [];
  readonly upsertCalls: Array<{ userId: string; facts: unknown[]; sourceTurnId?: string }> = [];

  private nextId = 1;

  /** Deterministic REAL uuids — the v4 schema rejects invented id shapes. */
  private id(): string {
    const id = this.nextId;
    this.nextId += 1;
    return `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
  }

  async rememberFact(
    userId: string,
    input: RememberFactInput,
    now: Date,
    sourceTurnId?: string,
  ): Promise<RememberFactOutcome> {
    const factKey = computeFactKey(input.fact);
    const keyMatches = this.rows.filter(
      r => r.userId === userId && r.category === input.category && r.factKey === factKey,
    );
    const byId = input.factId !== undefined ? this.rows.filter(r => r.id === input.factId) : [];
    const candidates = byId.length > 0 ? byId : keyMatches;
    const existing = candidates.find(r => r.status === 'active') ?? candidates[candidates.length - 1] ?? null;

    const evidenceAt = input.evidenceAt ?? now;
    if (existing !== null && existing.status === 'archived') {
      const closureAt = closureMoment(existing);
      if (closureAt !== null && evidenceAt.getTime() <= closureAt.getTime()) {
        return { outcome: 'skipped_stale_evidence', fact: existing };
      }
      // Newer evidence: a NEW row linked to the closed one — never un-archived.
      const row: UserFact = {
        id: this.id(),
        userId,
        category: input.category,
        fact: input.fact,
        factKey,
        muscleGroup: input.muscleGroup ?? null,
        confirmations: 1,
        sourceTurnId: sourceTurnId ?? null,
        createdAt: now,
        updatedAt: now,
        durability: input.durability,
        expiresAt: null,
        reviewAfter: null,
        phaseNote: input.phaseNote ?? null,
        phaseAt: null,
        onExpiry: null,
        status: 'active',
        archivedAt: null,
        archivedReason: null,
        closedByUserAt: null,
        supersedesId: input.supersedesFactId ?? existing.id,
        context: input.context ?? null,
        evidence: input.evidence ?? null,
      };
      this.rows.push(row);
      return { outcome: 'created', fact: row };
    }

    if (existing !== null) {
      // D-C with a correction exception: an in-place update rewrites and bumps.
      existing.fact = input.fact;
      existing.factKey = factKey;
      existing.confirmations += 1;
      existing.updatedAt = now;
      return { outcome: 'updated', fact: existing };
    }

    const row: UserFact = {
      id: this.id(),
      userId,
      category: input.category,
      fact: input.fact,
      factKey,
      muscleGroup: input.muscleGroup ?? null,
      confirmations: 1,
      sourceTurnId: sourceTurnId ?? null,
      createdAt: now,
      updatedAt: now,
      durability: input.durability,
      expiresAt: null,
      reviewAfter: null,
      phaseNote: input.phaseNote ?? null,
      phaseAt: null,
      onExpiry: null,
      status: 'active',
      archivedAt: null,
      archivedReason: null,
      closedByUserAt: null,
      supersedesId: input.supersedesFactId ?? null,
      context: input.context ?? null,
      evidence: input.evidence ?? null,
    };
    this.rows.push(row);
    return { outcome: 'created', fact: row };
  }

  async confirmFact(userId: string, factId: string, now: Date): Promise<boolean> {
    const row = this.rows.find(r => r.id === factId && r.userId === userId && r.status === 'active');
    if (row === undefined) {
      return false;
    }
    row.confirmations += 1; // D-C: the text never moves
    row.updatedAt = now;
    return true;
  }

  async supersedeFact(
    userId: string,
    input: SupersedeFactInput,
    evidenceAt: Date,
    now: Date,
  ): Promise<RememberFactOutcome | null> {
    const old = this.rows.find(r => r.id === input.factId && r.userId === userId);
    if (old === undefined) {
      return null;
    }
    if (old.status === 'archived') {
      const closureAt = closureMoment(old);
      if (closureAt !== null && evidenceAt.getTime() <= closureAt.getTime()) {
        return { outcome: 'skipped_stale_evidence', fact: old };
      }
    }
    old.status = 'archived';
    old.archivedAt = now;
    old.archivedReason = 'superseded';
    old.updatedAt = now;
    const row: UserFact = {
      id: this.id(),
      userId,
      category: input.category,
      fact: input.fact,
      factKey: computeFactKey(input.fact),
      muscleGroup: input.muscleGroup ?? null,
      confirmations: 1,
      sourceTurnId: null,
      createdAt: now,
      updatedAt: now,
      durability: input.durability,
      expiresAt: null,
      reviewAfter: null,
      phaseNote: input.phaseNote ?? null,
      phaseAt: null,
      onExpiry: null,
      status: 'active',
      archivedAt: null,
      archivedReason: null,
      closedByUserAt: null,
      supersedesId: old.id,
      context: input.context ?? null,
      evidence: input.evidence ?? null,
    };
    this.rows.push(row);
    return { outcome: 'created', fact: row };
  }

  async retractFact(
    userId: string,
    input: { factId: string; evidenceAt?: Date; reason?: string },
    now: Date,
  ): Promise<UserFact | null> {
    const row = this.rows.find(r => r.id === input.factId && r.userId === userId);
    if (row === undefined) {
      return null;
    }
    if (row.status === 'archived') {
      return row; // idempotent
    }
    row.status = 'archived';
    row.archivedAt = now;
    row.archivedReason = 'user_closed';
    row.closedByUserAt = input.evidenceAt ?? now;
    if (input.reason != null) {
      row.context = input.reason;
    }
    row.updatedAt = now;
    return row;
  }

  async forgetFact(userId: string, input: { factId: string; evidenceAt?: Date }, now: Date): Promise<UserFact | null> {
    const row = this.rows.find(r => r.id === input.factId && r.userId === userId);
    if (row === undefined) {
      return null;
    }
    if (row.archivedReason !== 'user_deleted') {
      row.closedByUserAt = row.closedByUserAt ?? input.evidenceAt ?? now;
      if (row.status === 'active') {
        row.status = 'archived';
        row.archivedAt = now;
      }
      row.archivedReason = 'user_deleted';
      row.updatedAt = now;
    }
    return row;
  }

  async listFacts(userId: string, includeArchived: boolean, now: Date): Promise<FactsListing> {
    const rows = this.rows.filter(r => r.userId === userId);
    return {
      active: rows.filter(r => isActiveForPrompt(r, now)),
      archived: includeArchived ? rows.filter(r => r.status === 'archived' && r.archivedReason !== 'user_deleted') : [],
    };
  }

  async getForPrompt(userId: string, now: Date, cap = 50): Promise<UserFact[]> {
    this.promptCalls.push({ userId, now });
    return this.rows.filter(r => r.userId === userId && isActiveForPrompt(r, now)).slice(0, cap);
  }

  async getExpiredActive(userId: string, now: Date): Promise<UserFact[]> {
    return this.rows.filter(r => r.userId === userId && isExpired(r, now));
  }

  async archiveExpired(userId: string, factId: string, now: Date): Promise<boolean> {
    const row = this.rows.find(r => r.id === factId && r.userId === userId);
    if (row === undefined || !isExpired(row, now)) {
      return false;
    }
    Object.assign(row, { status: 'archived', archivedAt: now, archivedReason: 'expired', updatedAt: now });
    return true;
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

  readonly promptCalls: Array<{ userId: string; now: Date }> = [];
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
    weightMode: 'required',
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

/** A complete v4 EpisodeSummary payload rendered as a ```json fence (BUG-017). */
function fencedOperations(factOperations: unknown[]): string {
  const payload = {
    topics: ['lower back injury discussed'],
    decisions: [],
    userState: ['recovering from a lower back injury'],
    trainingFeedback: [],
    openItems: [],
    factOperations,
  };
  return `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

/**
 * The fact verifier's answer (fact-verification plan Task 2), same fence —
 * the structured FIFO is shared, and the verifier call always follows the
 * summariser's inside one compaction.
 */
function fencedVerdicts(verdicts: Array<{ index: number; supported: boolean; reason: string }>): string {
  return `\`\`\`json\n${JSON.stringify({ verdicts }, null, 2)}\n\`\`\``;
}

const ADD_INJURY = [
  {
    op: 'add',
    category: 'physical_constraint',
    fact: 'User has a lower back injury — no direct loading of the lower back',
    muscleGroup: 'lower_back',
    durability: 'permanent',
    // BUG-040 (fact-provenance): a verbatim quote from the episode's User line —
    // the deterministic guard requires it before the operation is applied.
    evidence: 'травма поясницы',
  },
];
/** The second compaction restates the SAME fact — v4 says confirm by id, not re-add. */
const CONFIRM_INJURY = [{ op: 'confirm', factId: '00000000-0000-4000-8000-000000000001' }];

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
    // Course check OFF (course-check plan Task 1): this scenario scripts a
    // FIFO of structured answers for the compactions — the course check would
    // consume them out of order. Its own journeys are Task 3's (AC-FL-7).
    courseCheckEnabled: false,
    checkpointer: new MemorySaver(),
  } as unknown as ConversationGraphDeps;
}

/** Text of a message whether `content` is a string or a list of text parts (D2/D3). */
function textOf(m: BaseMessage): string {
  return textOnly(m.content) ?? JSON.stringify(m.content);
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
    structuredAnswers.push(
      fencedOperations(ADD_INJURY),
      // The verifier call right after the summariser's: the injury is the
      // user's own statement → supported (fact-verification Task 2).
      fencedVerdicts([{ index: 0, supported: true, reason: 'the user stated the injury' }]),
      // The second compaction is confirm-only — no verifier call for it (D2).
      fencedOperations(CONFIRM_INJURY),
    );

    // --- Step 1: the user states a lower-back injury in an episode.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage(INJURY_MESSAGE)] },
      ctxConfig({ runId: 'run-1', now: T0 }),
    );
    const run1Input = recorded[0]!;
    // D2: the current message is a list of text parts (<context>, then the user's own text).
    expect(run1Input.some(m => m._getType() === 'human' && textOf(m).includes('поясницы'))).toBe(true);

    // --- Step 2: compaction — the summariser answers INSIDE a ```json fence
    // through the REAL gateway; the summary is stored and the add operation applied.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('Спасибо, до связи.')] },
      ctxConfig({ runId: 'run-2', now: T1 }),
    );

    expect(summariesInsert).toHaveBeenCalledTimes(1);
    expect(summariesInsert.mock.calls[0][0]).toMatchObject({
      userId: 'u1',
      structured: {
        factOperations: ADD_INJURY,
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
    // The fenced answers cost exactly TWO provider calls — the summariser's
    // plus the verifier's (BUG-017's recovery, not the old blind retry).
    expect(modelFactory.__structuredCalls()).toBe(2);

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
    // D2: both blocks live in the one stable system message, facts first.
    expect(factsBlock).toBe(episodesBlock);
    expect(String(factsBlock!.content).indexOf('## User Facts')).toBeLessThan(
      String(factsBlock!.content).indexOf('## Previous episodes'),
    );

    // --- Step 4: hard validation — PRIMARY lower_back is rejected with a
    // user_error quoting the fact (nothing persisted); secondary-only passes.
    const run3SecondInput = recorded[3]! as BaseMessage[];
    const rejection = run3SecondInput.find(
      (m: BaseMessage) => m._getType() === 'tool' && (m as ToolMessage).tool_call_id === 'call-sts-1',
    ) as ToolMessage | undefined;
    expect(rejection).toBeDefined();
    // D3: the post-tool nudge rides on this ToolMessage as an extra text part.
    const rejectionText = textOf(rejection!);
    expect(rejectionText).toContain('Cannot proceed');
    expect(rejectionText).toContain(FACT_V1);
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
    expect(textOf(acceptance!)).toContain('Session created (ID: sess-1)');

    // --- Step 5: a later compaction restating the same fact confirms it.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('План отличный.')] },
      ctxConfig({ runId: 'run-4', now: T3 }),
    );

    expect(summariesInsert).toHaveBeenCalledTimes(2);
    expect(facts.rows).toHaveLength(1); // confirm did not duplicate the row
    expect(facts.rows[0]!.confirmations).toBe(2); // the counter bumped...
    expect(facts.rows[0]!.fact).toBe(FACT_V1); // ...but the stored text is never rewritten (D-C)
    // Two compactions: summariser+verifier, then a confirm-only summariser.
    expect(modelFactory.__structuredCalls()).toBe(3);
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
        evidence: null,
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
        evidence: null,
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
        evidence: null,
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

  it('AC-FL-3 end to end: a fact the user closed is NOT resurrected by compacting an OLDER episode', async () => {
    const T0 = new Date('2026-09-19T10:00:00Z'); // the episode's user message (the evidence)
    const T1 = new Date('2026-09-20T10:00:00Z'); // the user closes the fact
    const T2 = new Date('2026-09-21T10:00:00Z'); // the compaction run (well after the closure)
    const facts = new InMemoryUserFactsService();
    const deps = makeDeps(facts);
    const graph = buildConversationGraph(deps);

    const { __recorded: recorded, __script: script, __structuredAnswers: structuredAnswers } = modelFactory;
    const callsBefore = modelFactory.__structuredCalls();
    recorded.length = 0;
    script.length = 0;
    structuredAnswers.length = 0;
    script.push(
      // Run 1 (chat): the injury is discussed; plain-text reply.
      () => new AIMessage({ content: 'Понял, учту.', tool_calls: [] }),
      // Run 2 (chat): the compaction run; plain-text reply.
      () => new AIMessage({ content: 'Хорошо.', tool_calls: [] }),
    );
    // The compaction's summariser returns the injury as an ADD — exactly the
    // "blind upsert" v3 would have done. The verifier supports it (the user
    // did state it), so v4 + evidenceAt is what must refuse it.
    structuredAnswers.push(
      fencedOperations([
        {
          op: 'add',
          category: 'physical_constraint',
          fact: 'User has a lower back injury — no direct loading of the lower back',
          muscleGroup: 'lower_back',
          durability: 'permanent',
          evidence: 'травма поясницы',
        },
      ]),
      fencedVerdicts([{ index: 0, supported: true, reason: 'the user stated the injury' }]),
    );

    // --- Run 1 creates the episode that mentions the injury.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage(INJURY_MESSAGE)] },
      ctxConfig({ runId: 'run-1', now: T0 }),
    );
    expect(facts.rows).toHaveLength(0); // nothing written yet — extraction is compaction's job

    // --- The user closes the fact at T1 (the manage_fact retract path, Task 2).
    const stated = await facts.rememberFact(
      'u1',
      {
        category: 'physical_constraint',
        fact: 'User has a lower back injury — no direct loading of the lower back',
        muscleGroup: 'lower_back',
        durability: 'short',
        ttlDays: 7,
      },
      T0,
    );
    const closedId = stated.outcome === 'created' ? stated.fact.id : null;
    if (closedId === null) {
      throw new Error('expected created');
    }
    await facts.retractFact('u1', { factId: closedId }, T1);
    expect(facts.rows[0]!.status).toBe('archived');

    // --- Run 2 at T2 compacts the T0 episode; its evidence (state.lastUserMessageAt
    // = T0, the previous run's stamp) PREDATES the T1 closure.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('Спасибо, до связи.')] },
      ctxConfig({ runId: 'run-2', now: T2 }),
    );

    // The summariser and the verifier both ran and returned their answers —
    // but the closed fact did NOT come back (the call counter is cumulative
    // across this file's tests — assert the delta).
    expect(modelFactory.__structuredCalls()).toBe(callsBefore + 2);
    const active = facts.rows.filter(r => r.status === 'active');
    expect(active).toEqual([]); // skipped_stale_evidence — T0 evidence vs T1 closure
    expect(facts.rows[0]!.status).toBe('archived'); // the closure is intact
    expect(facts.rows).toHaveLength(1); // no resurrection row was created
  });

  it('BUG-040 / AC-FP-1..4: a coach-only figure (~70%) from the episode is not stored and never reaches ## User Facts', async () => {
    const T0 = new Date('2026-09-27T10:00:00Z');
    const T1 = new Date(T0.getTime() + 5 * 60_000); // run 2: T1 - T0 ≥ gap → compaction
    const T2 = new Date(T1.getTime() + 10_000); // run 3: T2 - T1 < gap → no compaction
    const facts = new InMemoryUserFactsService();
    const deps = makeDeps(facts);
    const { insert: summariesInsert } = deps.summaries as unknown as { insert: jest.Mock };
    const graph = buildConversationGraph(deps);

    const { __recorded: recorded, __script: script, __structuredAnswers: structuredAnswers } = modelFactory;
    const callsBefore = modelFactory.__structuredCalls();
    recorded.length = 0;
    script.length = 0;
    structuredAnswers.length = 0;
    script.push(
      // Run 1 (chat): the COACH's own claim — the only place "~70%" appears.
      () =>
        new AIMessage({
          content: '«130 кг» = блины полностью + ~70% веса платформы, реальная нагрузка выше.',
          tool_calls: [],
        }),
      // Run 2 (chat, the compaction run): plain-text reply.
      () => new AIMessage({ content: 'Всегда пожалуйста.', tool_calls: [] }),
      // Run 3 (chat): plain-text reply.
      () => new AIMessage({ content: 'Продолжаем.', tool_calls: [] }),
    );
    // The summariser's add even QUOTES the user line (a well-formed evidence) —
    // but the "~70%" figure appears in no user message: the VERIFIER's
    // unsupported verdict (fact-verification plan, D1 replaced the string
    // check) is what refuses it. The BUG-040 2075cb9f write.
    structuredAnswers.push(
      fencedOperations([
        {
          op: 'add',
          category: 'equipment',
          fact: 'On the 45° leg press the platform weight (~70% of its mass) adds to the plates',
          durability: 'long_term',
          evidence: 'Почему ты жим ногами называешь рычажным тренажёром?',
        },
      ]),
      fencedVerdicts([{ index: 0, supported: false, reason: 'the ~70% figure is the assistant’s own' }]),
    );

    // --- Run 1: the user only ASKS; the figure comes from the coach's reply.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('Почему ты жим ногами называешь рычажным тренажёром?')] },
      ctxConfig({ runId: 'run-1', now: T0 }),
    );
    expect(facts.rows).toHaveLength(0); // nothing written yet — extraction is compaction's job

    // --- Run 2: compaction — the summariser promotes the coach's figure to a fact.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('Понятно, спасибо.')] },
      ctxConfig({ runId: 'run-2', now: T1 }),
    );

    expect(summariesInsert).toHaveBeenCalledTimes(1); // the summary itself still applies (D-E)
    expect(facts.rows).toHaveLength(0); // the add was skipped — the verifier said unsupported
    expect(modelFactory.__structuredCalls()).toBe(callsBefore + 2); // summariser + verifier both answered

    // --- Run 3: the next run's model input must not carry the figure as a user fact.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('Что ты помнишь обо мне?')] },
      ctxConfig({ runId: 'run-3', now: T2 }),
    );

    const run3Input = recorded[2]!;
    const factsBlock = run3Input.find(m => m._getType() === 'system' && String(m.content).includes('## User Facts'));
    // With no stored fact there is no block at all; if anything is stored, none
    // of it may carry the coach's figure.
    if (factsBlock !== undefined) {
      expect(String(factsBlock!.content)).not.toContain('70%');
    }
    expect(facts.rows.filter(r => r.fact.includes('70%'))).toEqual([]); // belt: nothing stored anywhere
  });
});
