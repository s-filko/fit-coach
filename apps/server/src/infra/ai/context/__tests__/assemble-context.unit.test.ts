/**
 * Unit tests for the context assembler (ADR-0013 §3.4 / AC-1323; one message
 * shape for every phase since refactor-p4-episode-memory Task 5 — INV-LLM-001:
 * history interleaves from the checkpointed `messages` channel, summaries
 * render as the `## Previous episodes` block for every phase alike). The
 * assembler reports; it does not trim. The message-assembly snapshots are the
 * byte-identity arbiter.
 */
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

import type { StoredEpisodeSummary } from '@domain/conversation/episode';

import { IN_FLIGHT_POST_TOOL } from '../../../../../evals/fixtures/assembly-scenarios';
import { assembleContext, type AssembleInput } from '../assemble-context';
import { TOKEN_ESTIMATOR_ID } from '../token-estimator';

const SYSTEM = 'SYSTEM PROMPT UNDER TEST';
const USER_MESSAGE = 'Привет, что сегодня?';
const NOW = new Date('2026-09-18T12:00:00Z');

const EPISODE_SUMMARY: StoredEpisodeSummary = {
  episodeId: '11111111-1111-4111-8111-111111111111',
  phaseAtEnd: 'training',
  endedAt: '2026-09-17T18:00:00Z',
  summary: {
    topics: ['bench press session'],
    decisions: ['keep upper/lower split'],
    userState: ['mild shoulder discomfort'],
    trainingFeedback: [],
    openItems: ['day 2 not logged'],
  },
};

function input(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    systemPrompt: SYSTEM,
    episodeSummaries: [],
    history: [],
    current: [new HumanMessage(USER_MESSAGE)],
    now: NOW,
    timezone: null,
    ...overrides,
  };
}

/** P4: history is the checkpointed BaseMessage channel (INV-LLM-001). */
function historyFixture(): BaseMessage[] {
  return [new HumanMessage('Привет'), new AIMessage({ content: 'Здравствуй! Готовы тренироваться?', tool_calls: [] })];
}

function isType(m: BaseMessage, type: string): boolean {
  return m._getType() === type;
}

describe('assembleContext (ADR-0013 §3.4 / AC-1323; one shape — INV-LLM-001)', () => {
  it('no summaries, empty history → [system, human]', () => {
    const { messages, budgetReport } = assembleContext(input());

    expect(messages).toEqual([new SystemMessage(SYSTEM), new HumanMessage(USER_MESSAGE)]);
    expect(budgetReport.summary).toBe(0);
    expect(budgetReport.historyTurns).toBe(0);
    expect(budgetReport.messages).toBe(2);
  });

  it('with episode summaries → the two system messages stay separate (§3.4 blocks 1–2)', () => {
    const { messages, budgetReport } = assembleContext(input({ episodeSummaries: [EPISODE_SUMMARY] }));

    expect(messages).toHaveLength(3);
    expect(String(messages[0].content)).toBe(SYSTEM);
    expect(String(messages[1].content)).toContain('## Previous episodes');
    expect(String(messages[1].content)).toContain('bench press session');
    expect(String(messages[1].content)).toContain('not authoritative');
    expect(isType(messages[2], 'human')).toBe(true);
    expect(budgetReport.messages).toBe(3);
    expect(budgetReport.summary).toBeGreaterThan(0);
  });

  it('INV-LLM-001: history interleaves as messages for EVERY phase — no frame, no phase parameter', () => {
    const { messages, budgetReport } = assembleContext(input({ history: historyFixture() }));

    // [system, ...history, human(current)] — history flows through untouched
    expect(messages.slice(1, 3)).toEqual(historyFixture());
    expect(isType(messages[3], 'human')).toBe(true);
    expect(budgetReport.historyTurns).toBe(1);
    expect(messages.some(m => String(m.content).startsWith('=== CONVERSATION HISTORY'))).toBe(false);
  });

  it('post-tool current → in-flight messages follow the human message, no tool-results block', () => {
    const { messages, budgetReport } = assembleContext(
      input({ current: [new HumanMessage(USER_MESSAGE), ...IN_FLIGHT_POST_TOOL] }),
    );

    expect(isType(messages[0], 'system')).toBe(true);
    expect(isType(messages[1], 'human')).toBe(true);
    expect(messages.slice(2)).toEqual(IN_FLIGHT_POST_TOOL);
    expect(messages.some(m => String(m.content).startsWith('=== TOOL EXECUTION RESULTS ==='))).toBe(false);
    expect(budgetReport.toolResults).toBe(0); // always 0 since P4 (D-H)
    expect(budgetReport.inFlight).toBeGreaterThan(0);
  });

  it('total equals the sum of the six parts in every case', () => {
    const cases: AssembleInput[] = [
      input(),
      input({ episodeSummaries: [EPISODE_SUMMARY] }),
      input({ history: historyFixture() }),
      input({ current: [new HumanMessage(USER_MESSAGE), ...IN_FLIGHT_POST_TOOL] }),
      input({
        history: historyFixture(),
        episodeSummaries: [EPISODE_SUMMARY],
        current: [new HumanMessage(USER_MESSAGE), ...IN_FLIGHT_POST_TOOL],
      }),
    ];

    for (const caseInput of cases) {
      const { budgetReport: r } = assembleContext(caseInput);
      expect(r.total).toBe(r.system + r.summary + r.history + r.user + r.inFlight + r.toolResults);
    }
  });

  it('estimator is TOKEN_ESTIMATOR_ID; messages counts the returned array', () => {
    const { messages, budgetReport } = assembleContext(
      input({ history: historyFixture(), current: [new HumanMessage(USER_MESSAGE), ...IN_FLIGHT_POST_TOOL] }),
    );

    expect(budgetReport.estimator).toBe(TOKEN_ESTIMATOR_ID);
    expect(budgetReport.messages).toBe(messages.length);
  });

  it('pure: same input twice → deep-equal output (now comes in as data)', () => {
    const first = assembleContext(input({ history: historyFixture(), episodeSummaries: [EPISODE_SUMMARY] }));
    const second = assembleContext(input({ history: historyFixture(), episodeSummaries: [EPISODE_SUMMARY] }));

    expect(first.messages).toEqual(second.messages);
    expect(first.budgetReport).toEqual(second.budgetReport);
  });

  // P4 context-budget plan, Task 2 (ADR-0013 §3.4 block 3, D-A/D-B): the
  // caller hands already-rendered blocks (agent.node.ts renders them from
  // spec.contextBlocks); the assembler only places them and reports tokens.
  describe('block 3 — domain blocks (ADR-0013 §3.4)', () => {
    it('no blocks (default) → same shape as before (no behaviour change)', () => {
      const { messages, budgetReport } = assembleContext(input());
      expect(messages).toEqual([new SystemMessage(SYSTEM), new HumanMessage(USER_MESSAGE)]);
      expect(budgetReport.blocks).toEqual([]);
      expect(budgetReport.domain).toBe(0);
    });

    it('one block → its own SystemMessage after the summaries block, before history', () => {
      const { messages, budgetReport } = assembleContext(
        input({
          episodeSummaries: [EPISODE_SUMMARY],
          history: historyFixture(),
          blocks: [{ id: 'chat.context', text: 'CLIENT NAME: Alex', tokens: 42, depth: 5 }],
        }),
      );

      // [system, summaries, domain block, ...history, human]
      expect(messages).toHaveLength(6);
      expect(String(messages[0].content)).toBe(SYSTEM);
      expect(String(messages[1].content)).toContain('## Previous episodes');
      expect(isType(messages[2], 'system')).toBe(true);
      expect(String(messages[2].content)).toBe('CLIENT NAME: Alex');
      expect(messages.slice(3, 5)).toEqual(historyFixture());
      expect(isType(messages[5], 'human')).toBe(true);

      expect(budgetReport.blocks).toEqual([{ id: 'chat.context', tokens: 42, depth: 5 }]);
      expect(budgetReport.domain).toBe(42);
    });

    it('multiple blocks compose into one SystemMessage, spec order, joined like compose()', () => {
      const { messages, budgetReport } = assembleContext(
        input({
          blocks: [
            { id: 'training.client', text: 'CLIENT BLOCK', tokens: 3, depth: 0 },
            { id: 'training.workout_overview', text: 'OVERVIEW BLOCK', tokens: 5, depth: 0 },
          ],
        }),
      );

      expect(String(messages[1].content)).toBe('CLIENT BLOCK\n\nOVERVIEW BLOCK');
      expect(budgetReport.domain).toBe(8);
      expect(budgetReport.blocks).toEqual([
        { id: 'training.client', tokens: 3, depth: 0 },
        { id: 'training.workout_overview', tokens: 5, depth: 0 },
      ]);
    });

    it('empty blocks array renders no domain SystemMessage (all blocks returned null upstream)', () => {
      const { messages, budgetReport } = assembleContext(input({ blocks: [] }));
      expect(messages).toEqual([new SystemMessage(SYSTEM), new HumanMessage(USER_MESSAGE)]);
      expect(budgetReport.domain).toBe(0);
    });

    it('total includes domain tokens', () => {
      const { budgetReport } = assembleContext(input({ blocks: [{ id: 'x', text: 'hello', tokens: 7, depth: 0 }] }));
      expect(budgetReport.total).toBe(
        budgetReport.system +
          budgetReport.summary +
          budgetReport.domain +
          budgetReport.history +
          budgetReport.user +
          budgetReport.inFlight +
          budgetReport.toolResults,
      );
    });
  });
});
