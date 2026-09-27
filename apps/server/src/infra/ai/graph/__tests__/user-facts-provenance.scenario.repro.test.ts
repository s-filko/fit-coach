/**
 * REPRODUCTION (RED) — AC-FP-1..4 / BUG-040 (scenario half). Runs only via an
 * explicit --testMatch; promoted into user-facts.scenario.unit.test.ts when
 * the fix lands (fact-provenance Task 2), and this file is deleted.
 *
 * The end-to-end shape of BUG-040: in an episode where the user only ASKED a
 * question and the COACH invented a figure («~70% веса платформы»), the
 * summariser's `add` promotes that figure into a durable user fact — which
 * then renders in the next run's `## User Facts` block as if the user had
 * said it. After the fix the operation is skipped (no user evidence), nothing
 * is stored and the block stays clean.
 *
 * Same harness as user-facts.scenario.unit.test.ts (the model stubbed beneath
 * the REAL OpenAiLlmGateway; the graph real, ports stubbed), with a MINIMAL
 * in-memory facts service — only rememberFact/getForPrompt semantics matter
 * here. The op deliberately carries NO evidence field: v4's strict schema
 * would reject an unknown key, and a missing field must skip the operation
 * anyway (D2).
 */
import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';

import type { FactsListing, IUserFactsService, RememberFactInput, UserFact } from '@domain/user/ports';

import { OpenAiLlmGateway } from '@infra/ai/llm.gateway';

import { buildConversationGraph, type ConversationGraphDeps } from '../conversation.graph';
import { USER, ctxConfig } from './graph-test-support';

/**
 * Minimal recording stand-in for IUserFactsService: rememberFact appends an
 * active row (created outcome), getForPrompt returns the active rows — the
 * lifecycle corners the sibling unit file pins are not this scenario's job.
 */
class RecordingUserFactsService implements IUserFactsService {
  readonly rows: UserFact[] = [];
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
  ): Promise<{ outcome: 'created'; fact: UserFact }> {
    const row: UserFact = {
      id: this.id(),
      userId,
      category: input.category,
      fact: input.fact,
      factKey: input.fact,
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
      supersedesId: null,
      context: input.context ?? null,
    };
    this.rows.push(row);
    return { outcome: 'created', fact: row };
  }

  async getForPrompt(userId: string): Promise<UserFact[]> {
    return this.rows.filter(r => r.userId === userId && r.status === 'active');
  }

  async getConstraints(userId: string): Promise<UserFact[]> {
    const active = await this.getForPrompt(userId);
    return active.filter(r => r.category === 'physical_constraint');
  }

  async confirmFact(): Promise<boolean> {
    return false; // not this scenario's path
  }

  async supersedeFact(): Promise<null> {
    return null; // not this scenario's path
  }

  async retractFact(): Promise<null> {
    return null; // not this scenario's path
  }

  async forgetFact(): Promise<null> {
    return null;
  }

  async listFacts(userId: string): Promise<FactsListing> {
    return { active: await this.getForPrompt(userId), archived: [] };
  }

  async getExpiredActive(): Promise<UserFact[]> {
    return [];
  }

  async archiveExpired(): Promise<boolean> {
    return false;
  }
}

// The scripted model: chat answers from a FIFO script (the agent node's
// invoke), structured answers from a FIFO of RAW contents (the real gateway's
// withConfig().invoke — fenced on purpose). Chat inputs are recorded.
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

/** A complete v4 EpisodeSummary payload rendered as a ```json fence (BUG-017). */
function fencedOperations(factOperations: unknown[]): string {
  const payload = {
    topics: ['leg press vs lever machine discussed'],
    decisions: [],
    userState: [],
    trainingFeedback: [],
    openItems: [],
    factOperations,
  };
  return `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

/** The summariser's add: the "~70%" figure is the COACH's own, the user only asked. */
const ADD_COACH_FIGURE = [
  {
    op: 'add',
    category: 'equipment',
    fact: 'On the 45° leg press the platform weight (~70% of its mass) adds to the plates',
    durability: 'long_term',
  },
];

const USER_QUESTION = 'Почему ты жим ногами называешь рычажным тренажёром?';
const COACH_CLAIM = '«130 кг» = блины полностью + ~70% веса платформы, реальная нагрузка выше.';

function makeDeps(userFacts: IUserFactsService): ConversationGraphDeps {
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
      findByIdsWithMuscles: jest.fn().mockResolvedValue([]),
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
    // keepTurns 0: the compaction must fold the whole episode into a summary
    // (the fact pipeline under test) — the tail would defer it.
    episodeConfig: { gapMs: 60_000, minTurns: 0, minTokens: 0, keepTurns: 0 },
    // Course check OFF: this scenario scripts a FIFO of structured answers for
    // the compaction — the course check would consume them out of order.
    courseCheckEnabled: false,
    checkpointer: new MemorySaver(),
  } as unknown as ConversationGraphDeps;
}

describe('user-facts provenance scenario end to end (BUG-040, AC-FP-1..4)', () => {
  it('a coach-only figure (~70%) from the episode is not stored and never reaches ## User Facts', async () => {
    const facts = new RecordingUserFactsService();
    const deps = makeDeps(facts);
    const { insert: summariesInsert } = deps.summaries as unknown as { insert: jest.Mock };
    const graph = buildConversationGraph(deps);

    const T0 = new Date('2026-09-27T10:00:00Z');
    const T1 = new Date(T0.getTime() + 5 * 60_000); // run 2: T1 - T0 ≥ gap → compaction
    const T2 = new Date(T1.getTime() + 10_000); // run 3: T2 - T1 < gap → no compaction

    const { __recorded: recorded, __script: script, __structuredAnswers: structuredAnswers } = modelFactory;
    recorded.length = 0;
    script.length = 0;
    structuredAnswers.length = 0;
    script.push(
      // Run 1 (chat): the COACH's own claim — the only place "~70%" appears.
      () => new AIMessage({ content: COACH_CLAIM, tool_calls: [] }),
      // Run 2 (chat, the compaction run): plain-text reply.
      () => new AIMessage({ content: 'Всегда пожалуйста.', tool_calls: [] }),
      // Run 3 (chat): plain-text reply.
      () => new AIMessage({ content: 'Продолжаем.', tool_calls: [] }),
    );
    structuredAnswers.push(fencedOperations(ADD_COACH_FIGURE));

    // --- Run 1: the user only ASKS; the figure comes from the coach's reply.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage(USER_QUESTION)] },
      ctxConfig({ runId: 'run-1', now: T0 }),
    );
    expect(facts.rows).toHaveLength(0); // nothing written yet — extraction is compaction's job

    // --- Run 2: compaction — the summariser promotes the coach's figure to a fact.
    await graph.invoke(
      { phase: 'chat', messages: [new HumanMessage('Понятно, спасибо.')] },
      ctxConfig({ runId: 'run-2', now: T1 }),
    );

    expect(summariesInsert).toHaveBeenCalledTimes(1); // the summary itself still applies (D-E)
    // RED today: the add went through verbatim — the user never said "~70%".
    expect(facts.rows).toHaveLength(0);
    expect(modelFactory.__structuredCalls()).toBe(1); // the summariser DID answer

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
    // Belt: no row anywhere in the store carries the coach-only figure.
    expect(facts.rows.filter(r => r.fact.includes('70%'))).toEqual([]);
  });
});
