/**
 * The course check through the REAL graph (course-check plan Task 1, AC-FL-5):
 * the call-count discipline end to end — MemorySaver + a mocked chat model +
 * a mocked gateway, no provider anywhere. Pins what the unit tests cannot:
 * prepare actually runs the step, the persisted directive survives the
 * checkpointer between runs, the agent renders it as ONE block ahead of the
 * history with the user's message last, an ordinary turn costs zero extra
 * calls, and a provider failure never blocks the reply.
 */
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';

import type { UserFact } from '@domain/user/ports';

import { buildConversationGraph, type ConversationGraphDeps } from '../conversation.graph';
import { USER, ctxConfig } from './graph-test-support';

jest.mock('@infra/ai/model.factory', () => {
  const recorded: BaseMessage[][] = [];
  const model = {
    bindTools: () => model,
    invoke: async (messages: BaseMessage[]) => {
      recorded.push(messages);
      return new AIMessage({ content: 'Ок, понял.', tool_calls: [] });
    },
  };
  return { getModel: () => model, __recorded: recorded };
});
const { __recorded } = jest.requireMock('@infra/ai/model.factory') as { __recorded: BaseMessage[][] };

jest.mock('@shared/logger', () => {
  const fns = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => fns, __logFns: fns };
});
const { __logFns: logFns } = jest.requireMock('@shared/logger') as {
  __logFns: { warn: jest.Mock };
};

const DIRECTIVE = {
  vector: 'Build muscle 3×/week, upper/lower split',
  constraints: ['Left shoulder: no heavy overhead pressing'],
  questions: ['How does the shoulder feel today?'],
  suspectFacts: [],
  exerciseVerdicts: [],
};

const T0 = new Date('2026-09-21T09:00:00Z');
const at = (hours: number): Date => new Date(T0.getTime() + hours * 3_600_000);

function fact(id: string, text: string): UserFact {
  return {
    id,
    userId: 'u1',
    category: 'physical_constraint',
    fact: text,
    factKey: text.toLowerCase(),
    muscleGroup: 'shoulders_front',
    confirmations: 1,
    sourceTurnId: null,
    createdAt: T0,
    updatedAt: T0,
    durability: 'long_term',
    expiresAt: null,
    reviewAfter: new Date('2026-12-01T00:00:00Z'),
    phaseNote: null,
    phaseAt: null,
    onExpiry: null,
    status: 'active',
    archivedAt: null,
    archivedReason: null,
    closedByUserAt: null,
    supersedesId: null,
    context: null,
  };
}

interface Harness {
  deps: ConversationGraphDeps;
  facts: UserFact[];
  /** Active short facts past their TTL (getExpiredActive's rows); archiveExpired removes from it. */
  expired: UserFact[];
  structured: jest.Mock;
}

function makeHarness(): Harness {
  const facts: UserFact[] = [fact('f1', 'Left shoulder aches when pressing')];
  const expired: UserFact[] = [];
  const structured = jest.fn().mockResolvedValue(DIRECTIVE);
  const deps = {
    trainingService: {
      getTrainingHistory: jest.fn().mockResolvedValue([]),
      getSessionDetails: jest.fn().mockResolvedValue(null),
      getActivePlan: jest.fn().mockResolvedValue(null),
      completeSession: jest.fn(),
      startSession: jest.fn(),
    } as never,
    workoutPlanRepo: { findActiveByUserId: jest.fn().mockResolvedValue(null) } as never,
    workoutSessionRepo: { findRecentByUserIdWithDetails: jest.fn().mockResolvedValue([]) } as never,
    exerciseRepository: {
      searchByEmbedding: jest.fn().mockResolvedValue([]),
      findByIds: jest.fn().mockResolvedValue([]),
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
    summaries: { insert: jest.fn(), latestLegacySummary: jest.fn().mockResolvedValue(null) },
    userFacts: {
      upsertMany: jest.fn().mockResolvedValue(0),
      getForPrompt: jest.fn(() => Promise.resolve([...facts])),
      getConstraints: jest.fn().mockResolvedValue([]),
      getExpiredActive: jest.fn(() => Promise.resolve([...expired])),
      archiveExpired: jest.fn((_userId: string, factId: string) => {
        expired.splice(0, expired.length, ...expired.filter(f => f.id !== factId));
        return Promise.resolve(true);
      }),
    },
    llmGateway: { chat: jest.fn(), structured } as never,
    runService: { recordRun: jest.fn() } as never,
    // 24h gap, compaction inert for a same-day conversation: every structured
    // call in this file is the course check.
    episodeConfig: { gapMs: 24 * 3_600_000, minTurns: 2, minTokens: 300, keepTurns: 6 },
    checkpointer: new MemorySaver(),
  } as unknown as ConversationGraphDeps;
  return { deps, facts, expired, structured };
}

async function turn(
  graph: ReturnType<typeof buildConversationGraph>,
  n: number,
  hours: number,
  text: string,
): Promise<{ messages: BaseMessage[] }> {
  return (await graph.invoke(
    { phase: 'chat', messages: [new HumanMessage(text)] },
    ctxConfig({ runId: `run-${n}`, now: at(hours) }),
  )) as { messages: BaseMessage[] };
}

/** The model input of the most recent agent call. */
function lastModelInput(): BaseMessage[] {
  return __recorded[__recorded.length - 1]!;
}

const directiveBlocks = (input: BaseMessage[]): BaseMessage[] =>
  input.filter(m => m._getType() === 'system' && String(m.content).includes('## Course Directive'));

describe('course check through the graph (AC-FL-5)', () => {
  beforeEach(() => {
    __recorded.length = 0;
    logFns.warn.mockClear();
  });

  it('call-count discipline: one call on the first run, zero on ordinary turns, one more when a fact changes', async () => {
    const { deps, facts, structured } = makeHarness();
    const graph = buildConversationGraph(deps);

    await turn(graph, 1, 0, 'Привет');
    expect(structured).toHaveBeenCalledTimes(1);
    expect(structured.mock.calls[0]?.[2]).toMatchObject({ profile: 'course_check' });

    await turn(graph, 2, 1, 'Как дела?');
    await turn(graph, 3, 2, 'Что делаем?');
    expect(structured).toHaveBeenCalledTimes(1); // the stored directive rode two ordinary turns

    facts.push(fact('f2', 'Trains at home with dumbbells'));
    await turn(graph, 4, 3, 'Я тренируюсь дома');
    expect(structured).toHaveBeenCalledTimes(2); // changed fact set refires
    await turn(graph, 5, 4, 'Ок');
    expect(structured).toHaveBeenCalledTimes(2); // and settles again
  });

  it('the directive reaches the model as ONE block after the facts; the user’s message is last and outranks it', async () => {
    const { deps } = makeHarness();
    const graph = buildConversationGraph(deps);

    await turn(graph, 1, 0, 'Привет');
    await turn(graph, 2, 1, 'Плечо уже не болит');

    const input = lastModelInput();
    const blocks = directiveBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(String(blocks[0]!.content)).toContain('Build muscle 3×/week');
    expect(String(blocks[0]!.content)).toContain('always outranks this directive');
    // Persisted across the checkpointer: run 2 rendered it without a second call.
    const factsIdx = input.findIndex(m => String(m.content).includes('## User Facts'));
    expect(factsIdx).toBeGreaterThanOrEqual(0);
    expect(input.indexOf(blocks[0]!)).toBe(factsIdx + 1);
    const last = input[input.length - 1]!;
    expect(last._getType()).toBe('human');
    expect(String(last.content)).toBe('Плечо уже не болит');
  });

  it('a provider failure never blocks the reply: warn logged, the answer still comes, no directive block on a first run', async () => {
    const { deps, structured } = makeHarness();
    structured.mockRejectedValue(new Error('provider down'));
    const graph = buildConversationGraph(deps);

    const out = await turn(graph, 1, 0, 'Привет');

    const reply = out.messages[out.messages.length - 1]!;
    expect(reply._getType()).toBe('ai');
    expect(String(reply.content)).toBe('Ок, понял.');
    expect(logFns.warn).toHaveBeenCalledTimes(1);
    expect(directiveBlocks(lastModelInput())).toHaveLength(0);
  });

  it('back-off through the checkpointer: after a failure, ordinary turns on the same inputs cost ONE call in total, the stale directive keeps rendering, new inputs fire at once', async () => {
    const { deps, facts, structured } = makeHarness();
    const graph = buildConversationGraph(deps);

    await turn(graph, 1, 0, 'Привет');
    expect(structured).toHaveBeenCalledTimes(1);

    // The inputs move and the provider goes down: one failed attempt …
    facts.push(fact('f2', 'Trains at home with dumbbells'));
    structured.mockRejectedValue(new Error('provider down'));
    await turn(graph, 2, 1, 'Я тренируюсь дома');
    expect(structured).toHaveBeenCalledTimes(2);

    // … then five ordinary turns inside the cooldown cost nothing more, and
    // every one of them still carries the previously stored directive.
    for (let n = 3; n <= 7; n++) {
      await turn(graph, n, 1 + (n - 2) / 60, 'Ок');
      expect(directiveBlocks(lastModelInput())).toHaveLength(1);
      expect(String(directiveBlocks(lastModelInput())[0]!.content)).toContain('Build muscle 3×/week');
    }
    expect(structured).toHaveBeenCalledTimes(2);
    expect(logFns.warn).toHaveBeenCalledTimes(1);

    // New inputs are not covered by the cooldown.
    facts.push(fact('f3', 'No barbell'));
    structured.mockResolvedValue({ ...DIRECTIVE, vector: 'Home dumbbell training' });
    await turn(graph, 8, 1.2, 'И штанги нет');
    expect(structured).toHaveBeenCalledTimes(3);
    expect(String(directiveBlocks(lastModelInput())[0]!.content)).toContain('Home dumbbell training');
  });

  it('the expiry question is ONE-SHOT: rendered in the run that asked, gone from the next — zero calls, the rest of the directive intact', async () => {
    const { deps, expired, structured } = makeHarness();
    expired.push({
      ...fact('exp-1', 'Left shoulder tweaked while pressing'),
      durability: 'short',
      reviewAfter: null,
      expiresAt: at(-24),
      onExpiry: 'ask_once',
    });
    structured.mockResolvedValue({ ...DIRECTIVE, expiryQuestions: ['Did the shoulder tweak leave any trace?'] });
    const graph = buildConversationGraph(deps);

    await turn(graph, 1, 0, 'Привет');
    expect(structured).toHaveBeenCalledTimes(1);
    const first = String(directiveBlocks(lastModelInput())[0]!.content);
    expect(first).toContain('Did the shoulder tweak leave any trace?'); // asked in the run that fired it
    expect(first).toContain(DIRECTIVE.questions[0]); // alongside the ordinary directive question
    expect(expired).toEqual([]); // and the fact was archived in that same run
    // The checkpoint AT REST never carries the one-shot question, nor the stored directive.
    const atRest = (await graph.getState({ configurable: { thread_id: 'u1' } })).values as {
      courseExpiryQuestions: string[];
      courseDirective: { directive: Record<string, unknown> };
    };
    expect(atRest.courseExpiryQuestions).toEqual([]);
    expect(atRest.courseDirective.directive).not.toHaveProperty('expiryQuestions');

    for (const n of [2, 3, 4]) {
      await turn(graph, n, n - 1, 'Ок');
      const block = String(directiveBlocks(lastModelInput())[0]!.content);
      expect(block).not.toContain('Did the shoulder tweak leave any trace?'); // never stored, never re-asked
      expect(block).toContain(DIRECTIVE.questions[0]); // the rest of the directive persists as before
      expect(block).toContain('Build muscle 3×/week');
    }
    expect(structured).toHaveBeenCalledTimes(1); // unchanged fingerprint: zero further calls
  });

  it('an ask_once fact expired beyond the staleness bound is archived silently: no question, not in the check input', async () => {
    const { deps, expired, structured } = makeHarness();
    expired.push({
      ...fact('old-1', 'Right ankle rolled on a run'),
      durability: 'short',
      reviewAfter: null,
      expiresAt: at(-24 * 60), // sixty days ago — far past the 7-day default
      onExpiry: 'ask_once',
    });
    structured.mockResolvedValue({ ...DIRECTIVE, expiryQuestions: ['Did the ankle leave a trace?'] });
    const graph = buildConversationGraph(deps);

    await turn(graph, 1, 0, 'Привет');

    expect(expired).toEqual([]); // archived …
    const input = (structured.mock.calls[0]![1] as Array<{ content: string }>).map(m => m.content).join('\n');
    expect(input).not.toContain('Right ankle rolled on a run'); // … but never handed to the check
    // and even if the model volunteers a question, none was owed: it is dropped, not rendered
    expect(String(directiveBlocks(lastModelInput())[0]!.content)).not.toContain('Did the ankle leave a trace?');
  });

  it('a malformed answer is ignored the same way — the run is untouched', async () => {
    const { deps, structured } = makeHarness();
    structured.mockResolvedValue({ topics: [] });
    const graph = buildConversationGraph(deps);

    const out = await turn(graph, 1, 0, 'Привет');

    expect(String(out.messages[out.messages.length - 1]!.content)).toBe('Ок, понял.');
    expect(logFns.warn).toHaveBeenCalledTimes(1);
    expect(directiveBlocks(lastModelInput())).toHaveLength(0);
  });

  it('COURSE_CHECK_ENABLED=false: no call, no block — today’s behaviour', async () => {
    const { deps, structured } = makeHarness();
    (deps as unknown as { courseCheckEnabled: boolean }).courseCheckEnabled = false;
    const graph = buildConversationGraph(deps);

    await turn(graph, 1, 0, 'Привет');

    expect(structured).not.toHaveBeenCalled();
    expect(directiveBlocks(lastModelInput())).toHaveLength(0);
  });
});
