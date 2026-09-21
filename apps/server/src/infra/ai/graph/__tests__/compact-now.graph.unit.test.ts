/**
 * Manual compaction (`/compact`) through the REAL graph and adapter over a
 * MemorySaver — no provider, no database. Pins the trap that killed the first
 * attempts: `splitEpisode` cuts at the LAST HumanMessage, but a manual pass
 * appends none, so the user's freshest turn must still be folded (no tail),
 * and a short conversation must not silently do nothing.
 */
import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';

import { buildConversationRunner } from '../conversation-run.adapter';
import { buildConversationGraph, type ConversationGraphDeps } from '../conversation.graph';
import { USER, ctxConfig } from './graph-test-support';

jest.mock('@infra/ai/model.factory', () => {
  const model = {
    bindTools: () => model,
    invoke: async () => new AIMessage({ content: 'Ответ тренера', tool_calls: [] }),
  };
  return { getModel: () => model };
});

const SUMMARY = {
  topics: ['plan discussed'],
  decisions: [],
  userState: [],
  trainingFeedback: [],
  openItems: [],
  factOperations: [
    {
      op: 'add',
      category: 'physical_constraint',
      fact: 'left knee hurts on deep squats',
      durability: 'long_term',
    },
  ],
};

function setup(episode: { minTurns: number; minTokens: number } = { minTurns: 1, minTokens: 0 }) {
  const structured = jest.fn().mockResolvedValue(SUMMARY);
  const insert = jest.fn().mockResolvedValue({ summaryTurnId: 'st-1' });
  const rememberFact = jest.fn().mockResolvedValue({ outcome: 'created', fact: null });
  const appendRunMessages = jest.fn();
  const appendSystemNote = jest.fn();
  const recordRun = jest.fn();
  const deps = {
    trainingService: {
      getTrainingHistory: jest.fn().mockResolvedValue([]),
      getSessionDetails: jest.fn().mockResolvedValue(null),
    },
    workoutPlanRepo: { findActiveByUserId: jest.fn().mockResolvedValue(null) },
    workoutSessionRepo: { findRecentByUserIdWithDetails: jest.fn().mockResolvedValue([]) },
    exerciseRepository: {
      searchByEmbedding: jest.fn().mockResolvedValue([]),
      findByIds: jest.fn().mockResolvedValue([]),
    },
    embeddingService: { embed: jest.fn().mockResolvedValue(new Array(384).fill(0)) },
    userService: {
      getUser: jest.fn().mockResolvedValue(USER),
      isRegistrationComplete: jest.fn().mockReturnValue(true),
      needsRegistration: jest.fn().mockReturnValue(false),
    },
    transcript: { appendRunMessages, appendSystemNote },
    summaries: { insert, latestLegacySummary: jest.fn().mockResolvedValue(null) },
    userFacts: {
      getForPrompt: jest.fn().mockResolvedValue([]),
      getConstraints: jest.fn().mockResolvedValue([]),
      getExpiredActive: jest.fn().mockResolvedValue([]),
      rememberFact,
    },
    llmGateway: { chat: jest.fn(), structured },
    runService: { recordRun },
    // A day-long gap and a huge budget: no AUTOMATIC trigger can fire here.
    episodeConfig: { gapMs: 24 * 3600 * 1000, ...episode, keepTurns: 6 },
    courseCheckEnabled: false,
    checkpointer: new MemorySaver(),
  } as unknown as ConversationGraphDeps;
  const graph = buildConversationGraph(deps);
  const runner = buildConversationRunner({
    graph,
    userService: deps.userService,
    runService: deps.runService,
    checkpointer: { deleteThread: jest.fn() },
    transcript: deps.transcript,
  });
  const say = (runId: string, text: string) =>
    graph.invoke({ phase: 'chat', messages: [new HumanMessage(text)] }, ctxConfig({ runId }));
  const channel = async (): Promise<BaseMessage[]> =>
    ((await graph.getState({ configurable: { thread_id: 'u1' } })).values as { messages: BaseMessage[] }).messages;
  const state = async () =>
    (await graph.getState({ configurable: { thread_id: 'u1' } })).values as {
      messages: BaseMessage[];
      episodeSummaries: unknown[];
      lastUserMessageAt: string | null;
    };
  const dangle = (text: string) =>
    graph.updateState({ configurable: { thread_id: 'u1' } }, { messages: [new HumanMessage(text)] });
  return {
    runner,
    say,
    dangle,
    channel,
    state,
    structured,
    insert,
    rememberFact,
    appendRunMessages,
    appendSystemNote,
    recordRun,
  };
}

describe('ConversationRunPort.compact — the manual /compact pass', () => {
  it('folds the WHOLE conversation, including the user’s latest turn, and applies the fact operations', async () => {
    const t = setup();
    await t.say('run-1', 'Составь план на грудь');
    await t.say('run-2', 'Левое колено болит на глубоких приседах'); // the freshest user turn
    const before = await t.state();
    const runsBefore = t.recordRun.mock.calls.length;
    const transcriptWritesBefore = t.appendRunMessages.mock.calls.length;

    await expect(t.runner.compact('u1')).resolves.toBe('compacted');

    // The summariser saw the freshest turn (splitEpisode would have held it back).
    const transcript = JSON.stringify(t.structured.mock.calls[0]![1]);
    expect(transcript).toContain('Левое колено болит на глубоких приседах');
    expect(transcript).toContain('Составь план на грудь');
    // Nothing verbatim stays in the channel: no tail.
    const after = await t.state();
    expect(after.messages).toHaveLength(0);
    expect(after.episodeSummaries).toHaveLength(1);
    // The fact operation LANDED — that is the point of the command.
    expect(t.rememberFact).toHaveBeenCalledTimes(1);
    expect(t.insert).toHaveBeenCalledTimes(1);
    // …and nothing else happened: no agent reply, no transcript rows, no run row, clock untouched.
    expect(t.appendRunMessages).toHaveBeenCalledTimes(transcriptWritesBefore);
    expect(t.recordRun).toHaveBeenCalledTimes(runsBefore);
    expect(after.lastUserMessageAt).toBe(before.lastUserMessageAt);
  });

  it('a conversation whose last message is the user’s own (no reply yet) is folded too', async () => {
    const t = setup();
    await t.say('run-1', 'Первое сообщение');
    await t.dangle('Последнее, без ответа'); // as after an interrupted run

    await expect(t.runner.compact('u1')).resolves.toBe('compacted');

    expect(JSON.stringify(t.structured.mock.calls[0]![1])).toContain('Последнее, без ответа');
    expect(await t.channel()).toHaveLength(0);
  });

  it('a too-short conversation is nothing_to_compact: no model call, nothing touched', async () => {
    const t = setup({ minTurns: 2, minTokens: 0 });
    await t.say('run-1', 'Привет');
    const before = await t.state();

    await expect(t.runner.compact('u1')).resolves.toBe('nothing_to_compact');

    expect(t.structured).not.toHaveBeenCalled();
    expect(t.insert).not.toHaveBeenCalled();
    const after = await t.state();
    expect(after.messages.map(m => m.id)).toEqual(before.messages.map(m => m.id));
    expect(after.episodeSummaries).toHaveLength(0);
  });

  it('an empty thread is nothing_to_compact and does not import the legacy summary', async () => {
    const t = setup();

    await expect(t.runner.compact('u1')).resolves.toBe('nothing_to_compact');

    expect(t.structured).not.toHaveBeenCalled();
  });

  it('a summariser failure THROWS a typed error and removes nothing (automatic triggers degrade instead)', async () => {
    const t = setup();
    await t.say('run-1', 'Составь план на грудь');
    await t.say('run-2', 'Спасибо');
    const before = await t.channel();
    t.structured.mockRejectedValue(Object.assign(new Error('boom'), { status: 503 }));

    await expect(t.runner.compact('u1')).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });

    expect((await t.channel()).map(m => m.id)).toEqual(before.map(m => m.id));
    expect((await t.state()).episodeSummaries).toHaveLength(0);
    expect(t.insert).not.toHaveBeenCalled();
  });
});
