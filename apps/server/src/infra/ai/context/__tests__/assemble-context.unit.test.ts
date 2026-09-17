/**
 * Unit tests for the context assembler (ADR-0013 §3.4 / AC-1323,
 * refactor-p2-context-assembler Task 4; signature updated by
 * refactor-p3-phase-spec Task 2 — the layout comes from the spec, runs are
 * kept as separate SystemMessages). The assembler reports; it does not trim.
 * The message-assembly snapshots are the byte-identity arbiter.
 */
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

import type { ChatMsg } from '@domain/ai/types';

import { PHASE_PROMPTS, type PhaseLayout } from '@infra/ai/prompts';
import { renderBlock, SUMMARY_FRAME_V1 } from '@infra/ai/prompts/blocks';

import { IN_FLIGHT_POST_TOOL } from '../../../../../evals/fixtures/assembly-scenarios';
import { assembleContext, type AssembleInput } from '../assemble-context';
import { TOKEN_ESTIMATOR_ID } from '../token-estimator';

const SYSTEM = 'SYSTEM PROMPT UNDER TEST';
const SUMMARY = 'Previous conversation: the user trains bench press twice a week.';
const USER_MESSAGE = 'Привет, что сегодня?';

const CHAT_LAYOUT = PHASE_PROMPTS.chat.layout;
const REGISTRATION_LAYOUT = PHASE_PROMPTS.registration.layout;
const TRAINING_LAYOUT = PHASE_PROMPTS.training.layout;
const PLAN_CREATION_LAYOUT = PHASE_PROMPTS.plan_creation.layout;

function chatInput(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    systemPrompt: SYSTEM,
    previousSummary: null,
    history: [],
    userMessage: USER_MESSAGE,
    inFlight: [],
    ...overrides,
  };
}

function historyFixture(): ChatMsg[] {
  return [
    { role: 'user', content: 'Привет' },
    { role: 'assistant', content: 'Здравствуй! Готовы тренироваться?' },
  ];
}

function isType(m: BaseMessage, type: string): boolean {
  return m._getType() === type;
}

describe('assembleContext (ADR-0013 §3.4 / AC-1323)', () => {
  it('chat, no summary, empty history → [system, human]', () => {
    const { messages, budgetReport } = assembleContext(chatInput(), CHAT_LAYOUT);

    expect(messages).toEqual([new SystemMessage(SYSTEM), new HumanMessage(USER_MESSAGE)]);
    expect(budgetReport.summary).toBe(0);
    expect(budgetReport.historyTurns).toBe(0);
    expect(budgetReport.messages).toBe(2);
  });

  it('chat, with summary → the two system messages stay separate (ADR-0013 §3.4)', () => {
    const { messages, budgetReport } = assembleContext(chatInput({ previousSummary: SUMMARY }), CHAT_LAYOUT);

    const summaryText = renderBlock(SUMMARY_FRAME_V1, { previousSummary: SUMMARY });
    expect(messages).toEqual([
      new SystemMessage(SYSTEM),
      new SystemMessage(summaryText),
      new HumanMessage(USER_MESSAGE),
    ]);
    expect(budgetReport.messages).toBe(3);
    expect(String(messages[0].content)).toBe(SYSTEM);
    expect(String(messages[1].content)).toContain('CONTEXT FROM PREVIOUS CONVERSATION:');
    expect(budgetReport.summary).toBeGreaterThan(0);
  });

  it('registration, with summary → summary ignored', () => {
    const { messages, budgetReport } = assembleContext(chatInput({ previousSummary: SUMMARY }), REGISTRATION_LAYOUT);

    expect(budgetReport.summary).toBe(0);
    for (const m of messages) {
      expect(String(m.content)).not.toContain('CONTEXT FROM PREVIOUS CONVERSATION');
    }
  });

  it('training, with history → one history-frame system block, separate from the prompt', () => {
    const { messages } = assembleContext(chatInput({ history: historyFixture() }), TRAINING_LAYOUT);

    expect(messages.filter(m => isType(m, 'system'))).toHaveLength(2); // prompt + history frame
    expect(isType(messages[1], 'system')).toBe(true);
    expect(String(messages[1].content).startsWith('=== CONVERSATION HISTORY')).toBe(true);
    expect(String(messages[1].content)).toContain('[USER]: Привет');
    expect(String(messages[1].content)).toContain('[TRAINER]: Здравствуй! Готовы тренироваться?');
  });

  it('training, post-tool in-flight → array ends with the tool-results system block', () => {
    const { messages, budgetReport } = assembleContext(chatInput({ inFlight: IN_FLIGHT_POST_TOOL }), TRAINING_LAYOUT);

    const last = messages[messages.length - 1];
    expect(isType(last, 'system')).toBe(true);
    expect(String(last.content).startsWith('=== TOOL EXECUTION RESULTS ===')).toBe(true);
    expect(budgetReport.toolResults).toBeGreaterThan(0);
    expect(budgetReport.inFlight).toBeGreaterThan(0);
  });

  it('chat, post-tool in-flight → no tool-results block, in-flight appended after the human message', () => {
    const { messages } = assembleContext(chatInput({ inFlight: IN_FLIGHT_POST_TOOL }), CHAT_LAYOUT);

    expect(isType(messages[0], 'system')).toBe(true);
    expect(isType(messages[1], 'human')).toBe(true);
    expect(messages.slice(2)).toEqual(IN_FLIGHT_POST_TOOL);
    expect(messages.some(m => String(m.content).startsWith('=== TOOL EXECUTION RESULTS ==='))).toBe(false);
  });

  it('total equals the sum of the six parts in every case', () => {
    const cases: Array<{ input: AssembleInput; layout: PhaseLayout }> = [
      { input: chatInput(), layout: CHAT_LAYOUT },
      { input: chatInput({ previousSummary: SUMMARY }), layout: CHAT_LAYOUT },
      { input: chatInput({ previousSummary: SUMMARY }), layout: REGISTRATION_LAYOUT },
      { input: chatInput({ history: historyFixture() }), layout: CHAT_LAYOUT },
      { input: chatInput({ history: historyFixture() }), layout: TRAINING_LAYOUT },
      { input: chatInput({ inFlight: IN_FLIGHT_POST_TOOL }), layout: CHAT_LAYOUT },
      {
        input: chatInput({ history: historyFixture(), inFlight: IN_FLIGHT_POST_TOOL, previousSummary: SUMMARY }),
        layout: TRAINING_LAYOUT,
      },
      { input: chatInput({ previousSummary: SUMMARY, inFlight: IN_FLIGHT_POST_TOOL }), layout: PLAN_CREATION_LAYOUT },
    ];

    for (const { input, layout } of cases) {
      const { budgetReport: r } = assembleContext(input, layout);
      expect(r.total).toBe(r.system + r.summary + r.history + r.user + r.inFlight + r.toolResults);
    }
  });

  it('estimator is TOKEN_ESTIMATOR_ID; messages counts the returned array', () => {
    const { messages, budgetReport } = assembleContext(
      chatInput({ history: historyFixture(), inFlight: IN_FLIGHT_POST_TOOL }),
      CHAT_LAYOUT,
    );

    expect(budgetReport.estimator).toBe(TOKEN_ESTIMATOR_ID);
    expect(budgetReport.messages).toBe(messages.length);
  });

  it('pure: same input twice → deep-equal output, no Date use', () => {
    const dateSpy = jest.spyOn(global, 'Date');
    const input = chatInput({
      previousSummary: SUMMARY,
      history: historyFixture(),
      inFlight: IN_FLIGHT_POST_TOOL,
    });

    const first = assembleContext(input, TRAINING_LAYOUT);
    const second = assembleContext(input, TRAINING_LAYOUT);

    expect(first.messages).toEqual(second.messages);
    expect(first.budgetReport).toEqual(second.budgetReport);
    expect(dateSpy).not.toHaveBeenCalled();
    dateSpy.mockRestore();
  });

  it('layouts come from the caller (the spec hands PHASE_PROMPTS[phase].layout over)', () => {
    // registration has no summary frame and no tool-results block even with data present
    const registration = assembleContext(
      chatInput({ previousSummary: SUMMARY, inFlight: IN_FLIGHT_POST_TOOL }),
      REGISTRATION_LAYOUT,
    );
    expect(registration.budgetReport.summary).toBe(0);
    expect(registration.budgetReport.toolResults).toBe(0);

    // the registry layout for training is the history_frame mode
    expect(PHASE_PROMPTS.training.layout.historyMode).toBe('history_frame');
    expect(PHASE_PROMPTS.chat.layout.historyMode).toBe('interleaved');
  });
});
