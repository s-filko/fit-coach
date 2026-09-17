/**
 * Unit tests for the context assembler (ADR-0013 §3.4 / AC-1323,
 * refactor-p2-context-assembler Task 4). The assembler reports; it does not
 * trim. Message order must match today's five agentNodes exactly — the
 * Task 1 message-assembly snapshots are the byte-identity arbiter.
 */
import { AIMessage, HumanMessage, mergeMessageRuns, SystemMessage, type BaseMessage } from '@langchain/core/messages';

import type { ChatMsg } from '@domain/ai/types';

import { PHASE_PROMPTS } from '@infra/ai/prompts';
import { renderBlock, SUMMARY_FRAME_V1 } from '@infra/ai/prompts/blocks';

import { IN_FLIGHT_POST_TOOL } from '../../../../../evals/fixtures/assembly-scenarios';
import { assembleContext, type AssembleInput } from '../assemble-context';
import { TOKEN_ESTIMATOR_ID } from '../token-estimator';

const SYSTEM = 'SYSTEM PROMPT UNDER TEST';
const SUMMARY = 'Previous conversation: the user trains bench press twice a week.';
const USER_MESSAGE = 'Привет, что сегодня?';

function chatInput(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    phase: 'chat',
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
    const { messages, budgetReport } = assembleContext(chatInput());

    expect(messages).toEqual([new SystemMessage(SYSTEM), new HumanMessage(USER_MESSAGE)]);
    expect(budgetReport.summary).toBe(0);
    expect(budgetReport.historyTurns).toBe(0);
    expect(budgetReport.messages).toBe(2);
  });

  it('chat, with summary → the two system messages merge into one', () => {
    const { messages, budgetReport } = assembleContext(chatInput({ previousSummary: SUMMARY }));

    const expected = [
      ...mergeMessageRuns([
        new SystemMessage(SYSTEM),
        new SystemMessage(renderBlock(SUMMARY_FRAME_V1, { previousSummary: SUMMARY })),
      ]),
      new HumanMessage(USER_MESSAGE),
    ];
    expect(messages).toEqual(expected);
    expect(messages).toHaveLength(2); // merged system + human
    expect(String(messages[0].content)).toContain('CONTEXT FROM PREVIOUS CONVERSATION:');
    expect(budgetReport.summary).toBeGreaterThan(0);
  });

  it('registration, with summary → summary ignored', () => {
    const { messages, budgetReport } = assembleContext(chatInput({ phase: 'registration', previousSummary: SUMMARY }));

    expect(budgetReport.summary).toBe(0);
    for (const m of messages) {
      expect(String(m.content)).not.toContain('CONTEXT FROM PREVIOUS CONVERSATION');
    }
  });

  it('training, with history → one history-frame system block, unmerged with the prompt', () => {
    const { messages } = assembleContext(chatInput({ phase: 'training', history: historyFixture() }));

    expect(messages.filter(m => isType(m, 'system'))).toHaveLength(2); // prompt + history frame
    expect(isType(messages[1], 'system')).toBe(true);
    expect(String(messages[1].content).startsWith('=== CONVERSATION HISTORY')).toBe(true);
    expect(String(messages[1].content)).toContain('[USER]: Привет');
    expect(String(messages[1].content)).toContain('[TRAINER]: Здравствуй! Готовы тренироваться?');
  });

  it('training, post-tool in-flight → array ends with the tool-results system block', () => {
    const { messages, budgetReport } = assembleContext(chatInput({ phase: 'training', inFlight: IN_FLIGHT_POST_TOOL }));

    const last = messages[messages.length - 1];
    expect(isType(last, 'system')).toBe(true);
    expect(String(last.content).startsWith('=== TOOL EXECUTION RESULTS ===')).toBe(true);
    expect(budgetReport.toolResults).toBeGreaterThan(0);
    expect(budgetReport.inFlight).toBeGreaterThan(0);
  });

  it('chat, post-tool in-flight → no tool-results block, in-flight appended after the human message', () => {
    const { messages } = assembleContext(chatInput({ inFlight: IN_FLIGHT_POST_TOOL }));

    expect(isType(messages[0], 'system')).toBe(true);
    expect(isType(messages[1], 'human')).toBe(true);
    expect(messages.slice(2)).toEqual(IN_FLIGHT_POST_TOOL);
    expect(messages.some(m => String(m.content).startsWith('=== TOOL EXECUTION RESULTS ==='))).toBe(false);
  });

  it('total equals the sum of the six parts in every case', () => {
    const cases: AssembleInput[] = [
      chatInput(),
      chatInput({ previousSummary: SUMMARY }),
      chatInput({ phase: 'registration', previousSummary: SUMMARY }),
      chatInput({ history: historyFixture() }),
      chatInput({ phase: 'training', history: historyFixture() }),
      chatInput({ inFlight: IN_FLIGHT_POST_TOOL }),
      chatInput({
        phase: 'training',
        history: historyFixture(),
        inFlight: IN_FLIGHT_POST_TOOL,
        previousSummary: SUMMARY,
      }),
      chatInput({ phase: 'plan_creation', previousSummary: SUMMARY, inFlight: IN_FLIGHT_POST_TOOL }),
    ];

    for (const input of cases) {
      const { budgetReport: r } = assembleContext(input);
      expect(r.total).toBe(r.system + r.summary + r.history + r.user + r.inFlight + r.toolResults);
    }
  });

  it('estimator is TOKEN_ESTIMATOR_ID; messages counts the returned array', () => {
    const { messages, budgetReport } = assembleContext(
      chatInput({ history: historyFixture(), inFlight: IN_FLIGHT_POST_TOOL }),
    );

    expect(budgetReport.estimator).toBe(TOKEN_ESTIMATOR_ID);
    expect(budgetReport.messages).toBe(messages.length);
  });

  it('pure: same input twice → deep-equal output, no Date use', () => {
    const dateSpy = jest.spyOn(global, 'Date');
    const input = chatInput({
      phase: 'training',
      previousSummary: SUMMARY,
      history: historyFixture(),
      inFlight: IN_FLIGHT_POST_TOOL,
    });

    const first = assembleContext(input);
    const second = assembleContext(input);

    expect(first.messages).toEqual(second.messages);
    expect(first.budgetReport).toEqual(second.budgetReport);
    expect(dateSpy).not.toHaveBeenCalled();
    dateSpy.mockRestore();
  });

  it('layouts come from the registry (PHASE_PROMPTS[phase].layout drives the assembly)', () => {
    // registration has no summary frame and no tool-results block even with data present
    const registration = assembleContext(
      chatInput({
        phase: 'registration',
        previousSummary: SUMMARY,
        inFlight: IN_FLIGHT_POST_TOOL,
      }),
    );
    expect(registration.budgetReport.summary).toBe(0);
    expect(registration.budgetReport.toolResults).toBe(0);

    // the registry layout for training is the history_frame mode
    expect(PHASE_PROMPTS.training.layout.historyMode).toBe('history_frame');
    expect(PHASE_PROMPTS.training.layout.mergeRuns).toBe(false);
    expect(PHASE_PROMPTS.chat.layout.mergeRuns).toBe(true);
  });
});
