/**
 * BUG-018 reproduction (chat-continuity plan Task 0, AC-CC-4): the owner's
 * "привет" after a ~6-hour pause, on the real graph with the model mocked
 * BENEATH the real `OpenAiLlmGateway` (same harness as
 * user-facts.scenario.unit.test.ts). Prior state: one stored episode summary
 * whose openItems say the plan is ready and pending save, plus a ONE-turn
 * conversation in plan_creation (user "привет", assistant greeting). After a
 * gap of 6 h (EPISODE_GAP_HOURS default is 3) the user sends "привет" again,
 * through the real conversation-run adapter; the scripted model greets AND
 * calls search_exercises in one step, then dumps the plan after the tool
 * results.
 *
 * Cases (a)-(c) are the REQUIRED behaviour (AC-CC-1..3) and all three are
 * green now: (a) landed with the Task 1 compaction verbatim tail, (b) with
 * the Task 2 time-gap note, (c) with the Task 3 reply carrying every
 * assistant text of the run — the greeting reaches Telegram alongside the
 * plan dump.
 */
import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';

import type { RunResult } from '@domain/conversation/ports';

import { OpenAiLlmGateway } from '@infra/ai/llm.gateway';

import { buildConversationRunner } from '../conversation-run.adapter';
import { buildConversationGraph, type ConversationGraphDeps } from '../conversation.graph';
import { USER, ctxConfig } from './graph-test-support';

// The scripted model, exactly like user-facts.scenario.unit.test.ts: chat
// answers come from a FIFO script (the agent node's invoke), the summariser's
// structured answer from a FIFO of RAW fenced-JSON contents (the real
// gateway's withConfig().invoke). Every chat input is recorded.
jest.mock('@infra/ai/model.factory', () => {
  const recorded: BaseMessage[][] = [];
  const script: Array<() => AIMessage> = [];
  const structuredAnswers: string[] = [];
  const model = {
    bindTools: () => model,
    invoke: async (messages: BaseMessage[]) => {
      recorded.push(messages);
      const next = script.shift();
      return next ? next() : new AIMessage({ content: 'Хорошо.', tool_calls: [] });
    },
    withConfig: () => ({
      invoke: async () => {
        const answer = structuredAnswers.shift();
        if (answer === undefined) {
          throw new Error('No scripted structured answer left');
        }
        return { content: answer };
      },
    }),
  };
  return { getModel: () => model, __recorded: recorded, __script: script, __structuredAnswers: structuredAnswers };
});

const modelFactory = jest.requireMock('@infra/ai/model.factory') as {
  __recorded: BaseMessage[][];
  __script: Array<() => AIMessage>;
  __structuredAnswers: string[];
};

// --- The BUG-018 fixture texts ---------------------------------------------

/** The assistant greeting of the one-turn pre-pause exchange (its verbatim half). */
const OLD_GREETING = 'Привет! Рад тебя видеть. Чем сегодня займёмся — продолжим план или просто поболтаем?';

/** The scripted model's greeting for the new "привет" (written alongside tool calls). */
const GREETING = 'Hi! Good to see you back.';

/** The scripted model's final text after the tool results — the plan dump. */
const PLAN_DUMP = [
  'YOUR WEEKLY PLAN',
  '',
  'Day 1 — Chest & Triceps: Dumbbell Bench Press 4×10, Dips 3×12',
  'Day 2 — Back & Biceps: One-Arm Dumbbell Row 4×10, Pull-ups 3×8',
  'Day 3 — Legs & Shoulders: Goblet Squat 4×12, Lunges 3×12',
  'Weekend: 25 min light cardio',
  '',
  'The plan is ready and pending save — shall I save it?',
].join('\n');

// The old episode: two turns, comfortably over EPISODE_MIN_TOKENS (300), so
// its inactivity compaction goes through the summariser (not the D-B trim).
const OLD_H1 = [
  'Давай составим план тренировок на неделю. Я хочу три силовые тренировки в домашних условиях:',
  'первый день — грудь и трицепс, второй — спина и бицепс, третий — ноги и плечи.',
  'Из оборудования у меня есть только разборные гантели и турник в дверном проёме,',
  'в зал ходить не планирую, тренируюсь всегда дома по вечерам после работы.',
].join(' ');
const OLD_A1 = [
  'Отлично, дома с гантелями и турником можно собрать полноценный цикл.',
  'Предлагаю трёхдневный сплит: жим гантелей лёжа и отжимания на брусьях в первый день,',
  'тяга гантели в наклоне и подтягивания во второй, приседания с гантелями и выпады в третий.',
  'Между подходами отдых 90 секунд, кардио добавим после силовой части по самочувствию.',
].join(' ');
const OLD_H2 = [
  'Звучит хорошо. Давай зафиксируем этот вариант: три силовые дня по этому сплиту,',
  'плюс лёгкое кардио на 20-30 минут в выходные. Составь, пожалуйста, финальную версию плана',
  'со всеми упражнениями, подходами и повторениями, чтобы я мог её сохранить и начать на следующей неделе.',
].join(' ');
const OLD_A2 = [
  'Готово, финальная версия плана собрана: жим гантелей лёжа 4×10, отжимания на брусьях 3×12,',
  'тяга гантели в наклоне 4×10, подтягивания 3×8, приседания с гантелями 4×12, выпады 3×12,',
  'плюс кардио 25 минут в выходные. Осталось только сохранить план — скажи, когда будешь готов.',
].join(' ');

/** The stored summary of the old episode — openItems carry the pending-save agenda. */
const FENCED_SUMMARY = `\`\`\`json\n${JSON.stringify(
  {
    topics: ['weekly home training plan with dumbbells and a pull-up bar'],
    decisions: ['three strength days: chest+triceps, back+biceps, legs+shoulders'],
    userState: ['trains at home in the evenings'],
    trainingFeedback: [],
    openItems: ['The training plan is fully drafted and pending save'],
    facts: [],
  },
  null,
  2,
)}\n\`\`\``;

function searchCall(id: string, query: string) {
  return { id, name: 'search_exercises', args: { query }, type: 'tool_call' as const };
}

function makeDeps(): ConversationGraphDeps {
  return {
    trainingService: {
      getTrainingHistory: jest.fn().mockResolvedValue([]),
      getSessionDetails: jest.fn().mockResolvedValue(null),
      completeSession: jest.fn(),
      startSession: jest.fn(),
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
    userFacts: {
      upsertMany: jest.fn().mockResolvedValue(0),
      getForPrompt: jest.fn().mockResolvedValue([]),
      getConstraints: jest.fn().mockResolvedValue([]),
    },
    // The REAL gateway — only the ChatModel beneath it is the mock above.
    llmGateway: new OpenAiLlmGateway(),
    runService: { recordRun: jest.fn() } as never,
    // Production defaults (config/index.ts): 3 h gap, 2 turns / 300 tokens, 6-turn tail.
    episodeConfig: { gapMs: 3 * 3600 * 1000, minTurns: 2, minTokens: 300, keepTurns: 6 },
    checkpointer: new MemorySaver(),
  } as unknown as ConversationGraphDeps;
}

describe('BUG-018 reproduction — "привет" after a 6-hour pause (AC-CC-4)', () => {
  let delivered: RunResult;
  let run3FirstInput: BaseMessage[];

  beforeAll(async () => {
    const deps = makeDeps();
    const graph = buildConversationGraph(deps);
    // Delivery is real: the final run goes through the conversation-run
    // adapter, exactly as the bot route does.
    const runner = buildConversationRunner({
      graph,
      userService: deps.userService,
      runService: deps.runService,
      checkpointer: deps.checkpointer,
      transcript: deps.transcript,
    });

    const { __recorded: recorded, __script: script, __structuredAnswers: structuredAnswers } = modelFactory;
    recorded.length = 0;
    script.length = 0;
    structuredAnswers.length = 0;
    script.push(
      // The old episode (two turns).
      () => new AIMessage({ content: OLD_A1, tool_calls: [] }),
      () => new AIMessage({ content: OLD_A2, tool_calls: [] }),
      // The pre-pause exchange: the greeting of the one-turn episode.
      () => new AIMessage({ content: OLD_GREETING, tool_calls: [] }),
      // The new "привет": text AND search_exercises tool calls in one step…
      () =>
        new AIMessage({
          content: GREETING,
          tool_calls: [searchCall('call-se-1', 'dumbbell chest press'), searchCall('call-se-2', 'dumbbell back row')],
        }),
      // …then the plan dump after the tool results.
      () => new AIMessage({ content: PLAN_DUMP, tool_calls: [] }),
    );
    structuredAnswers.push(FENCED_SUMMARY);

    // The wall clock drives the final run (the adapter stamps `now` itself),
    // so the fixture times are anchored 6 h 5 min before it.
    const nowMs = Date.now();
    const tHello = new Date(nowMs - (6 * 3600 + 5 * 60) * 1000);
    const tOldA = new Date(tHello.getTime() - 14 * 3600 * 1000);
    const tOldB = new Date(tOldA.getTime() + 30_000);

    // The old episode: plan discussion, two turns, one episode.
    await graph.invoke(
      { phase: 'plan_creation', messages: [new HumanMessage(OLD_H1)] },
      ctxConfig({ runId: 'repro-old-1', now: tOldA }),
    );
    await graph.invoke(
      { phase: 'plan_creation', messages: [new HumanMessage(OLD_H2)] },
      ctxConfig({ runId: 'repro-old-2', now: tOldB }),
    );

    // The pre-pause exchange: the inactivity gap ends the old episode (its
    // summary — openItems "pending save" — lands through the REAL gateway),
    // and this one-turn exchange becomes the new current episode.
    await graph.invoke(
      { phase: 'plan_creation', messages: [new HumanMessage('привет')] },
      ctxConfig({ runId: 'repro-hello', now: tHello }),
    );

    // +6 h: the owner's "привет".
    delivered = await runner.run({ userId: 'u1', text: 'привет' });
    // The last two recorded inputs are this run's two model calls.
    run3FirstInput = recorded[recorded.length - 2]!;
  });

  test('(a) AC-CC-1 — the model input for the new "привет" still contains the one-turn exchange verbatim', () => {
    const aiTexts = run3FirstInput.filter(m => m._getType() === 'ai').map(m => String(m.content));
    expect(aiTexts).toContain(OLD_GREETING);
    // The exchange's human half: the pre-pause "привет" AND the current one.
    const hellos = run3FirstInput.filter(m => m._getType() === 'human' && String(m.content) === 'привет');
    expect(hellos).toHaveLength(2);
  });

  test('(b) AC-CC-2 — a time-gap system note sits immediately before the new "привет"', () => {
    let lastHuman = -1;
    for (let i = run3FirstInput.length - 1; i >= 0; i -= 1) {
      if (run3FirstInput[i]?._getType() === 'human') {
        lastHuman = i;
        break;
      }
    }
    expect(lastHuman).toBeGreaterThan(0);
    const note = run3FirstInput[lastHuman - 1];
    expect(note?._getType()).toBe('system');
    // The time-gap block's wording (Task 2): the measured gap is ~6.1 h.
    expect(String(note?.content)).toMatch(/The user returns after/i);
  });

  test('(c) AC-CC-3 — the delivered reply contains the greeting written alongside the tool calls', () => {
    expect(delivered.text).toContain(GREETING);
    // …and the final text still arrives after it (everything the run said, in order).
    expect(delivered.text).toContain(PLAN_DUMP);
    expect(delivered.text.indexOf(GREETING)).toBeLessThan(delivered.text.indexOf(PLAN_DUMP));
  });
});
