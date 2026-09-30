/**
 * Unit tests for the context assembler (ADR-0013 §3.4 / AC-1323; one message
 * shape for every phase since refactor-p4-episode-memory Task 5 — INV-LLM-001:
 * history interleaves from the checkpointed `messages` channel, summaries
 * render as the `## Previous episodes` block for every phase alike).
 * `assembleContext` now enforces INV-LLM-004 via `resolveBudget` (Task 3) —
 * these tests use a generous default budget so no case here trims by
 * accident; `budget.unit.test.ts` and `budget-replay.unit.test.ts` (Task 4)
 * own the resolution-order proofs. The message-assembly snapshots remain the
 * byte-identity arbiter for "what the model receives".
 */
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

import type { StoredEpisodeSummary, TokenBudget } from '@domain/conversation/episode';

import type { RenderableBlock } from '@infra/ai/prompts/blocks';

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
    facts: [],
  },
};

/** Generous enough that nothing in this file trims — resolution order is budget.unit.test.ts's job. */
const GENEROUS_BUDGET: TokenBudget = {
  system: 100000,
  longTerm: 100000,
  domain: 100000,
  history: 100000,
  outputReserve: 1,
};

function input(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    systemPrompt: SYSTEM,
    userFacts: [],
    episodeSummaries: [],
    history: [],
    current: [new HumanMessage(USER_MESSAGE)],
    budget: GENEROUS_BUDGET,
    now: NOW,
    timezone: null,
    user: null,
    ...overrides,
  };
}

/** A block fixture as a { id, render } pair, replacing Task 2's pre-rendered { id, text, tokens, depth } shape. */
function block(id: string, text: string): RenderableBlock<unknown> {
  return { id, render: () => text };
}

/** P4: history is the checkpointed BaseMessage channel (INV-LLM-001). */
function historyFixture(): BaseMessage[] {
  return [new HumanMessage('Привет'), new AIMessage({ content: 'Здравствуй! Готовы тренироваться?', tool_calls: [] })];
}

function isType(m: BaseMessage, type: string): boolean {
  return m._getType() === type;
}

/** Text of a message whether `content` is a string or a list of text parts. */
function textOf(m: BaseMessage): string {
  return typeof m.content === 'string'
    ? m.content
    : m.content.map(part => (part as { text?: string }).text ?? '').join('');
}

/** The current HumanMessage as the request carries it: a `<context>` part first, then the user's own text. */
function expectCurrentWithContext(m: BaseMessage, context: string[], userText = USER_MESSAGE): void {
  expect(isType(m, 'human')).toBe(true);
  expect(Array.isArray(m.content)).toBe(true);
  const parts = m.content as Array<{ type: string; text: string }>;
  expect(parts).toHaveLength(2);
  expect(parts[0]!.text.startsWith('<context>\n')).toBe(true);
  expect(parts[0]!.text.endsWith('\n</context>')).toBe(true);
  for (const piece of context) {
    expect(parts[0]!.text).toContain(piece);
  }
  expect(parts[1]!.text).toBe(userText);
}

describe('assembleContext (ADR-0013 §3.4 / AC-1323; one shape — INV-LLM-001)', () => {
  it('no summaries, empty history → [system, human]', async () => {
    const { messages, budgetReport } = await assembleContext(input());

    expect(messages).toEqual([new SystemMessage(SYSTEM), new HumanMessage(USER_MESSAGE)]);
    expect(budgetReport.summary).toBe(0);
    expect(budgetReport.historyTurns).toBe(0);
    expect(budgetReport.messages).toBe(2);
    expect(budgetReport.cuts).toEqual([]);
  });

  it('with episode summaries → one stable system message: block 1 then the summaries block (§3.4 blocks 1–2, D2)', async () => {
    const { messages, budgetReport } = await assembleContext(input({ episodeSummaries: [EPISODE_SUMMARY] }));

    expect(messages).toHaveLength(2);
    const system = String(messages[0].content);
    expect(system.startsWith(SYSTEM)).toBe(true);
    expect(system).toContain('## Previous episodes');
    expect(system.indexOf('## Previous episodes')).toBeGreaterThan(system.indexOf(SYSTEM));
    expect(system).toContain('bench press session');
    expect(system).toContain('not authoritative');
    expect(isType(messages[1], 'human')).toBe(true);
    expect(budgetReport.messages).toBe(2);
    expect(budgetReport.summary).toBeGreaterThan(0);
  });

  it('AC-PC-2: every input at once (facts, directive, summaries, blocks, gap note, NOW, history, in-flight) → exactly one SystemMessage, first', async () => {
    const { messages } = await assembleContext(
      input({
        userFacts: [
          {
            id: 'f1',
            userId: 'u1',
            category: 'equipment',
            fact: 'Trains at home',
            factKey: 'trains at home',
            muscleGroup: null,
            confirmations: 1,
            sourceTurnId: null,
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
            createdAt: new Date('2026-09-01T00:00:00Z'),
            updatedAt: new Date('2026-09-01T00:00:00Z'),
          },
        ],
        episodeSummaries: [EPISODE_SUMMARY],
        contextBlocks: [block('chat.context', 'CLIENT NAME: Alex')],
        history: historyFixture(),
        gapNote: 'The user returns after 14 h.',
        nowLine: 'NOW (user’s local time): Friday 2026-09-25 14:20 (Asia/Manila)',
        current: [new HumanMessage(USER_MESSAGE), ...IN_FLIGHT_POST_TOOL],
      }),
    );

    expect(isType(messages[0]!, 'system')).toBe(true);
    expect(messages.slice(1).filter(m => isType(m, 'system'))).toEqual([]);
  });

  it('INV-LLM-001: history interleaves as messages for EVERY phase — no frame, no phase parameter', async () => {
    const { messages, budgetReport } = await assembleContext(input({ history: historyFixture() }));

    // [system, ...history, human(current)] — history flows through untouched
    expect(messages.slice(1, 3)).toEqual(historyFixture());
    expect(isType(messages[3], 'human')).toBe(true);
    expect(budgetReport.historyTurns).toBe(1);
    expect(messages.some(m => String(m.content).startsWith('=== CONVERSATION HISTORY'))).toBe(false);
  });

  it('post-tool current → in-flight messages follow the human message, no tool-results block', async () => {
    const { messages, budgetReport } = await assembleContext(
      input({ current: [new HumanMessage(USER_MESSAGE), ...IN_FLIGHT_POST_TOOL] }),
    );

    expect(isType(messages[0], 'system')).toBe(true);
    expect(isType(messages[1], 'human')).toBe(true);
    expect(messages.slice(2)).toEqual(IN_FLIGHT_POST_TOOL);
    expect(messages.some(m => String(m.content).startsWith('=== TOOL EXECUTION RESULTS ==='))).toBe(false);
    expect(budgetReport.toolResults).toBe(0); // always 0 since P4 (D-H)
    expect(budgetReport.inFlight).toBeGreaterThan(0);
  });

  it('total equals the sum of the six parts in every case', async () => {
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
      // eslint-disable-next-line no-await-in-loop
      const { budgetReport: r } = await assembleContext(caseInput);
      expect(r.total).toBe(
        r.system + r.longTerm + r.summary + r.domain + r.history + r.user + r.inFlight + r.toolResults,
      );
    }
  });

  it('estimator is TOKEN_ESTIMATOR_ID; messages counts the returned array', async () => {
    const { messages, budgetReport } = await assembleContext(
      input({ history: historyFixture(), current: [new HumanMessage(USER_MESSAGE), ...IN_FLIGHT_POST_TOOL] }),
    );

    expect(budgetReport.estimator).toBe(TOKEN_ESTIMATOR_ID);
    expect(budgetReport.messages).toBe(messages.length);
  });

  it('budgetReport.budget echoes the input budget (D-C)', async () => {
    const { budgetReport } = await assembleContext(input());
    expect(budgetReport.budget).toEqual(GENEROUS_BUDGET);
  });

  it('pure: same input twice → deep-equal output (now comes in as data)', async () => {
    const first = await assembleContext(input({ history: historyFixture(), episodeSummaries: [EPISODE_SUMMARY] }));
    const second = await assembleContext(input({ history: historyFixture(), episodeSummaries: [EPISODE_SUMMARY] }));

    expect(first.messages).toEqual(second.messages);
    expect(first.budgetReport).toEqual(second.budgetReport);
  });

  // P4 context-budget plan, Task 2 (ADR-0013 §3.4 block 3, D-A/D-B): the
  // caller hands the phase's declared blocks + loaded data; the assembler
  // renders them (at full depth unless Task 3's resolveBudget steps one
  // down), places them, and reports tokens.
  describe('block 3 — domain blocks (ADR-0013 §3.4)', () => {
    it('no blocks (default) → same shape as before (no behaviour change)', async () => {
      const { messages, budgetReport } = await assembleContext(input());
      expect(messages).toEqual([new SystemMessage(SYSTEM), new HumanMessage(USER_MESSAGE)]);
      expect(budgetReport.blocks).toEqual([]);
      expect(budgetReport.domain).toBe(0);
    });

    it('one block → rides in the current HumanMessage’s <context> part (D2), never as a SystemMessage', async () => {
      const { messages, budgetReport } = await assembleContext(
        input({
          episodeSummaries: [EPISODE_SUMMARY],
          history: historyFixture(),
          contextBlocks: [block('chat.context', 'CLIENT NAME: Alex')],
        }),
      );

      // [system(block 1 + summaries), ...history, human(<context> + user text)]
      expect(messages).toHaveLength(4);
      expect(String(messages[0].content)).toContain('## Previous episodes');
      expect(String(messages[0].content)).not.toContain('CLIENT NAME: Alex');
      expect(messages.slice(1, 3)).toEqual(historyFixture());
      expectCurrentWithContext(messages[3]!, ['CLIENT NAME: Alex']);

      expect(budgetReport.blocks).toEqual([{ id: 'chat.context', tokens: expect.any(Number), depth: 0 }]);
      expect(budgetReport.domain).toBeGreaterThan(0);
    });

    it('multiple blocks compose into one <context> section, spec order, joined like compose()', async () => {
      const { messages, budgetReport } = await assembleContext(
        input({
          contextBlocks: [
            block('training.client', 'CLIENT BLOCK'),
            block('training.workout_overview', 'OVERVIEW BLOCK'),
          ],
        }),
      );

      expect(textOf(messages[1]!)).toContain('<context>\nCLIENT BLOCK\n\nOVERVIEW BLOCK\n</context>');
      expect(budgetReport.blocks.map(b => b.id)).toEqual(['training.client', 'training.workout_overview']);
    });

    it('a block that renders null is absent from the message array', async () => {
      const { messages, budgetReport } = await assembleContext(
        input({ contextBlocks: [{ id: 'absent', render: () => null }] }),
      );
      expect(messages).toEqual([new SystemMessage(SYSTEM), new HumanMessage(USER_MESSAGE)]);
      expect(budgetReport.domain).toBe(0);
      expect(budgetReport.blocks).toEqual([]);
    });

    it('INV-LLM-004 (d) D-D floor → block 3 is dropped too: only block 1 and current remain', async () => {
      const { messages, budgetReport } = await assembleContext(
        input({
          episodeSummaries: [EPISODE_SUMMARY],
          history: historyFixture(),
          contextBlocks: [block('chat.context', 'CLIENT NAME: Alex')],
          // A current message so large that (a)–(c) cannot bring the total within budget.
          current: [new HumanMessage('u'.repeat(20000))],
          budget: { system: 50, longTerm: 10, domain: 10, history: 10, outputReserve: 1 },
        }),
      );

      expect(budgetReport.cuts).toContain('floor');
      expect(messages).toHaveLength(2);
      expect(String(messages[0].content)).toBe(SYSTEM);
      expect(isType(messages[1], 'human')).toBe(true);
      expect(textOf(messages[1]!)).not.toContain('CLIENT NAME');
      expect(budgetReport.blocks).toEqual([]);
      expect(budgetReport.domain).toBe(0);
      expect(budgetReport.summary).toBe(0);
      expect(budgetReport.history).toBe(0);
    });

    it('empty contextBlocks array renders no domain SystemMessage', async () => {
      const { messages, budgetReport } = await assembleContext(input({ contextBlocks: [] }));
      expect(messages).toEqual([new SystemMessage(SYSTEM), new HumanMessage(USER_MESSAGE)]);
      expect(budgetReport.domain).toBe(0);
    });

    it('total includes domain tokens', async () => {
      const { budgetReport } = await assembleContext(input({ contextBlocks: [block('x', 'hello')] }));
      expect(budgetReport.total).toBe(
        budgetReport.system +
          budgetReport.longTerm +
          budgetReport.summary +
          budgetReport.domain +
          budgetReport.history +
          budgetReport.user +
          budgetReport.inFlight +
          budgetReport.toolResults,
      );
    });
  });

  // P6 Task 4 (D-F, ADR-0013 §3.4 block 2): `## User Facts` renders ahead of
  // `## Previous episodes` — long-term memory precedes episode memory.
  describe('block 2a — ## User Facts (P6 Task 4)', () => {
    const FACT = {
      id: 'f1',
      userId: 'u1',
      category: 'equipment' as const,
      fact: 'Trains at home with dumbbells only',
      factKey: 'trains at home with dumbbells only',
      muscleGroup: null,
      confirmations: 1,
      sourceTurnId: null,
      durability: 'permanent' as const,
      expiresAt: null,
      reviewAfter: null,
      phaseNote: null,
      phaseAt: null,
      onExpiry: null,
      status: 'active' as const,
      archivedAt: null,
      archivedReason: null,
      closedByUserAt: null,
      supersedesId: null,
      context: null,
      evidence: null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: new Date('2026-09-01T00:00:00Z'),
    };

    it('no facts (default []) → byte-identical to a run with no facts field at all', async () => {
      const withEmptyFacts = await assembleContext(input({ userFacts: [] }));
      const withoutFactsKey = await assembleContext(input());
      expect(withEmptyFacts.messages).toEqual(withoutFactsKey.messages);
      expect(withEmptyFacts.budgetReport).toEqual(withoutFactsKey.budgetReport);
      expect(withEmptyFacts.messages).toEqual([new SystemMessage(SYSTEM), new HumanMessage(USER_MESSAGE)]);
      expect(withEmptyFacts.budgetReport.longTerm).toBe(0);
    });

    it('with facts → facts precede the episode-summaries block inside the one stable system message (§3.4 block 2 ordering)', async () => {
      const { messages, budgetReport } = await assembleContext(
        input({ userFacts: [FACT], episodeSummaries: [EPISODE_SUMMARY] }),
      );

      // [system(block 1, facts, summaries), human]
      expect(messages).toHaveLength(2);
      const system = String(messages[0].content);
      expect(system.startsWith(SYSTEM)).toBe(true);
      expect(system).toContain('## User Facts');
      expect(system).toContain('Trains at home with dumbbells only');
      expect(system.indexOf('## User Facts')).toBeLessThan(system.indexOf('## Previous episodes'));
      expect(isType(messages[1], 'human')).toBe(true);
      expect(budgetReport.longTerm).toBeGreaterThan(0);
    });

    it('facts alone (no summaries) render right after block 1, before history', async () => {
      const { messages } = await assembleContext(input({ userFacts: [FACT], history: historyFixture() }));

      expect(String(messages[0].content).startsWith(SYSTEM)).toBe(true);
      expect(String(messages[0].content)).toContain('## User Facts');
      expect(messages.slice(1, 3)).toEqual(historyFixture());
      expect(isType(messages[3], 'human')).toBe(true);
    });

    it('INV-LLM-004 (d) D-D floor drops facts too: only block 1 and current remain', async () => {
      const { messages, budgetReport } = await assembleContext(
        input({
          userFacts: [FACT],
          episodeSummaries: [EPISODE_SUMMARY],
          history: historyFixture(),
          current: [new HumanMessage('u'.repeat(20000))],
          budget: { system: 50, longTerm: 10, domain: 10, history: 10, outputReserve: 1 },
        }),
      );

      expect(budgetReport.cuts).toContain('floor');
      expect(messages).toHaveLength(2);
      expect(budgetReport.longTerm).toBe(0);
    });

    it('total includes longTerm tokens', async () => {
      const { budgetReport } = await assembleContext(input({ userFacts: [FACT] }));
      expect(budgetReport.total).toBe(
        budgetReport.system +
          budgetReport.longTerm +
          budgetReport.summary +
          budgetReport.domain +
          budgetReport.history +
          budgetReport.user +
          budgetReport.inFlight +
          budgetReport.toolResults,
      );
    });
  });

  describe('gapNote (chat-continuity Task 2, AC-CC-2)', () => {
    it('the note rides in the current HumanMessage’s <context> part, after history (D2)', async () => {
      const { messages } = await assembleContext(
        input({ history: historyFixture(), gapNote: 'The user returns after 14 h.' }),
      );

      // [system, ...history(2), human(<context>note</context> + user text)]
      expect(messages).toHaveLength(4);
      expect(messages.filter(m => isType(m, 'system'))).toHaveLength(1);
      expectCurrentWithContext(messages[3]!, ['The user returns after 14 h.']);
    });

    it('no gapNote → no extra system message (the default shape is unchanged)', async () => {
      const { messages } = await assembleContext(input({ history: historyFixture() }));

      // [system, ...history(2), human]
      expect(messages).toHaveLength(4);
      expect(messages.filter(m => isType(m, 'system'))).toHaveLength(1);
    });

    it('the note rides with current at the D-D floor — never dropped, never splits current', async () => {
      const { messages, budgetReport } = await assembleContext(
        input({
          history: historyFixture(),
          gapNote: 'The user returns after 14 h.',
          current: [new HumanMessage('u'.repeat(20000))],
          budget: { system: 50, longTerm: 10, domain: 10, history: 10, outputReserve: 1 },
        }),
      );

      expect(budgetReport.cuts).toContain('floor');
      // Block 1, current (with the note in its <context>) — the note belongs to `current`, not to history.
      expect(messages).toHaveLength(2);
      expect(textOf(messages[1]!)).toContain('The user returns after');
      expect(isType(messages[1], 'human')).toBe(true);
    });
  });

  // now-line-last plan, D1/D2: the NOW line is its own SystemMessage after
  // the gap note, immediately before `current` — the last thing before the
  // run's human message, so everything ahead of it can hit the provider's
  // prompt cache. Rendered by agent.node.ts (the gap-note wiring) from the
  // same CURRENT_TIME_V1 renderer block 1 used to carry.
  describe('nowLine (now-line-last plan, AC-NL-1)', () => {
    const NOW_LINE = "NOW (user's local time): Friday 2026-09-25 14:20 (Asia/Manila)";

    it('rides in the current HumanMessage’s <context> part, after history (D2)', async () => {
      const { messages } = await assembleContext(input({ history: historyFixture(), nowLine: NOW_LINE }));

      // [system, ...history(2), human(<context>NOW</context> + user text)]
      expect(messages).toHaveLength(4);
      expect(messages.filter(m => isType(m, 'system'))).toHaveLength(1);
      expectCurrentWithContext(messages[3]!, [NOW_LINE]);
    });

    it('after the gap note when there is one: <context> = gap note, then NOW', async () => {
      const { messages } = await assembleContext(
        input({ history: historyFixture(), gapNote: 'The user returns after 14 h.', nowLine: NOW_LINE }),
      );

      // [system, ...history(2), human(<context>note\n\nNOW</context> + user text)]
      expect(messages).toHaveLength(4);
      expectCurrentWithContext(messages[3]!, ['The user returns after 14 h.\n\n' + NOW_LINE]);
    });

    it('no nowLine → no extra system message (the default shape is unchanged)', async () => {
      const { messages } = await assembleContext(input());
      expect(messages).toEqual([new SystemMessage(SYSTEM), new HumanMessage(USER_MESSAGE)]);
    });

    it('rides with current at the D-D floor — never dropped, never budgeted', async () => {
      const { messages, budgetReport } = await assembleContext(
        input({
          history: historyFixture(),
          episodeSummaries: [EPISODE_SUMMARY],
          nowLine: NOW_LINE,
          current: [new HumanMessage('u'.repeat(20000))],
          budget: { system: 50, longTerm: 10, domain: 10, history: 10, outputReserve: 1 },
        }),
      );

      expect(budgetReport.cuts).toContain('floor');
      // Block 1, current (NOW in its <context>) — it belongs to `current`, like the gap note.
      expect(messages).toHaveLength(2);
      expect(textOf(messages[1]!)).toContain(NOW_LINE);
      // Not budgeted: no dedicated report slot; only counted in `messages`.
      expect(budgetReport.messages).toBe(2);
    });
  });

  // course-check plan Task 1 (AC-FL-5): the persisted directive renders as ONE
  // prompt block — its own SystemMessage directly after `## User Facts`, ahead
  // of episode memory — and is measured by resolveBudget through the SAME
  // render call (its tokens ride in `longTerm`, the long-term steering slot).
  describe('block 2a′ — course directive (course-check plan Task 1, AC-FL-5)', () => {
    const FACT_ROW = {
      id: 'fact-1',
      userId: 'u1',
      category: 'physical_constraint' as const,
      fact: 'Left shoulder aches when pressing',
      factKey: 'left shoulder aches when pressing',
      muscleGroup: 'shoulders_front',
      confirmations: 2,
      sourceTurnId: null,
      durability: 'long_term' as const,
      expiresAt: null,
      reviewAfter: null,
      phaseNote: null,
      phaseAt: null,
      onExpiry: null,
      status: 'active' as const,
      archivedAt: null,
      archivedReason: null,
      closedByUserAt: null,
      supersedesId: null,
      context: null,
      evidence: null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: new Date('2026-09-01T00:00:00Z'),
    };
    const userFactsFixture = () => [FACT_ROW];

    const DIRECTIVE = {
      vector: 'Build muscle 3×/week, upper/lower split',
      constraints: ['Left shoulder: no heavy overhead pressing'],
      questions: ['How does the shoulder feel today?'],
      suspectFacts: [],
      exerciseVerdicts: [],
    };

    it('renders inside the stable system message right after the user-facts block, before summaries', async () => {
      const { messages, budgetReport } = await assembleContext(
        input({
          userFacts: userFactsFixture(),
          courseDirective: DIRECTIVE,
          episodeSummaries: [EPISODE_SUMMARY],
        }),
      );

      // [system(block 1, facts, directive, summaries), human]
      expect(messages).toHaveLength(2);
      const system = String(messages[0].content);
      const [iFacts, iDirective, iSummaries] = ['## User Facts', '## Course Directive', '## Previous episodes'].map(h =>
        system.indexOf(h),
      );
      expect(iFacts).toBeGreaterThan(0);
      expect(iDirective).toBeGreaterThan(iFacts!);
      expect(iSummaries).toBeGreaterThan(iDirective!);
      expect(system).toContain('Build muscle 3×/week');
      expect(system).toMatch(/outrank|always wins|takes precedence/i);
      expect(isType(messages[1], 'human')).toBe(true);
      expect(budgetReport.messages).toBe(2);
    });

    it('its tokens are counted in longTerm (the long-term steering slot — facts + directive)', async () => {
      const without = await assembleContext(input({ userFacts: userFactsFixture() }));
      const withDirective = await assembleContext(input({ userFacts: userFactsFixture(), courseDirective: DIRECTIVE }));

      expect(withDirective.budgetReport.longTerm).toBeGreaterThan(without.budgetReport.longTerm);
    });

    it('no directive → the shape is exactly today’s (no empty block, no extra message)', async () => {
      const { messages } = await assembleContext(input({ courseDirective: null }));

      expect(messages).toEqual([new SystemMessage(SYSTEM), new HumanMessage(USER_MESSAGE)]);
    });

    it('D-D floor drops the directive along with facts and summaries (INV-LLM-004 (d))', async () => {
      const { messages, budgetReport } = await assembleContext(
        input({
          userFacts: userFactsFixture(),
          courseDirective: DIRECTIVE,
          current: [new HumanMessage('u'.repeat(20000))],
          budget: { system: 50, longTerm: 10, domain: 10, history: 10, outputReserve: 1 },
        }),
      );

      expect(budgetReport.cuts).toContain('floor');
      expect(messages).toHaveLength(2); // block 1 + current only
      expect(String(messages[0].content)).toBe(SYSTEM);
      expect(messages.some(m => String(m.content).includes('## Course Directive'))).toBe(false);
    });
  });
});
