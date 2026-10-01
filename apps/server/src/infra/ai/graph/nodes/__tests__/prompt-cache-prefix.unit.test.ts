/**
 * Prompt-caching plan (BUG-051) T3 — AC-PC-1, -2, -4 (bound tools), -5 over the SERIALISED request: a real
 * ChatOpenAI with a capturing `fetch` (request-capture.ts), the agent node and the real training tool policy
 * around it (harness: prompt-cache-harness.ts). Promoted from `prompt-cache-prefix.repro.test.ts` (T2) once green.
 */
import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import { wireText, type WireRequest } from '../../../context/__tests__/request-capture';

import {
  EFFORT_HINT_RESULT,
  history0,
  lastHumanIndex,
  loadPlanTrainingData,
  makeLoadPlanTrainingSpec,
  noSets,
  oneSet,
  run,
  state,
  T0,
  T1,
  TOOLS,
} from './prompt-cache-harness';

jest.mock('@infra/ai/model.factory', () => ({
  getModel: () => (jest.requireActual('./prompt-cache-harness') as typeof import('./prompt-cache-harness')).state.model,
}));
jest.mock('@config/index', () => {
  const actual = jest.requireActual('@config/index');
  return {
    ...actual,
    // Lazy: the harness imports the agent node, which imports this module.
    loadConfig: () => ({
      ...actual.loadConfig(),
      ...(jest.requireActual('./prompt-cache-harness') as typeof import('./prompt-cache-harness')).state.config,
    }),
  };
});
jest.mock('@shared/logger', () => {
  const fns = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => fns };
});

beforeEach(() => {
  state.config = {};
  state.data = noSets();
});

describe('AC-PC-1: two consecutive training runs share a byte-identical prefix up to breakpoint 2', () => {
  async function twoRuns() {
    state.data = noSets();
    const first = await run([...history0(), new HumanMessage({ content: 'жим 60 на 8', id: 'h1' })], { now: T0 });
    // Between the runs: a set was logged (block 3 + availability changed), NOW moved a minute, gap note appears.
    state.data = oneSet();
    const second = await run(
      [
        ...history0(),
        new HumanMessage({ content: 'жим 60 на 8', id: 'h1' }),
        new AIMessage({ content: 'Записал!', id: 'a1' }),
        new HumanMessage({ content: 'ещё подход', id: 'h2' }),
      ],
      { now: T1, lastUserMessageAt: T0.toISOString() },
    );
    return { r1: first.requests[0]!, r2: second.requests[0]! };
  }

  it('AC-PC-1: the tool list of the second request equals the first (a set was logged in between)', async () => {
    const { r1, r2 } = await twoRuns();
    expect(r2.tools?.map(t => t.function.name)).toEqual(r1.tools?.map(t => t.function.name));
    expect(JSON.stringify(r2.tools)).toBe(JSON.stringify(r1.tools));
  });

  it('AC-PC-1: messages before the first request’s breakpoint 2 (everything ahead of its current turn) are identical in the second', async () => {
    const { r1, r2 } = await twoRuns();
    const prefix1 = r1.messages.slice(0, lastHumanIndex(r1));
    const prefix2 = r2.messages.slice(0, prefix1.length);
    expect(JSON.stringify(prefix2)).toBe(JSON.stringify(prefix1));
  });
});

describe('AC-PC-2: no SystemMessage after the first message, in every kind of request', () => {
  const systemsAfterFirst = (r: WireRequest) => r.messages.slice(1).filter(m => m.role === 'system');

  it('AC-PC-2: plain call with block 3, gap note and NOW line', async () => {
    const { requests } = await run([...history0(), new HumanMessage({ content: 'ещё', id: 'h1' })], {
      now: T1,
      lastUserMessageAt: T0.toISOString(),
    });
    expect(systemsAfterFirst(requests[0]!)).toEqual([]);
  });

  it('AC-PC-2: post-tool call (the nudge no longer rides as a SystemMessage)', async () => {
    const inFlight: BaseMessage[] = [
      new HumanMessage({ content: 'жим 60 на 8', id: 'h1' }),
      new AIMessage({
        content: '',
        id: 'a1',
        tool_calls: [{ id: 'c1', name: 'log_set', args: {}, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'c1', content: 'Logged set 1', id: 't1' }),
    ];
    const { requests } = await run([...history0(), ...inFlight], { now: T0 });
    expect(systemsAfterFirst(requests[0]!)).toEqual([]);
  });

  it('AC-PC-2: empty-reply retry request', async () => {
    const { requests } = await run([...history0(), new HumanMessage({ content: 'ещё', id: 'h1' })], {
      now: T0,
      responses: [{ content: '' }, { content: 'ok' }],
    });
    expect(requests).toHaveLength(2);
    expect(systemsAfterFirst(requests[0]!)).toEqual([]);
    expect(systemsAfterFirst(requests[1]!)).toEqual([]);
  });
});

describe('AC-PC-4 (bound tools): the bound tool list does not depend on session state (D4)', () => {
  it('AC-PC-4: delete_last_sets / update_last_set are bound before the first set of the current exercise', async () => {
    state.data = noSets();
    const { requests } = await run([...history0(), new HumanMessage({ content: 'привет', id: 'h1' })], { now: T0 });
    const names = requests[0]!.tools?.map(t => t.function.name) ?? [];
    expect(names).toEqual(TOOLS.map(t => t.name));
  });
});

describe('AC-PC-5: the checkpointed HumanMessage carries no <context> text (D2)', () => {
  it('AC-PC-5: the request has the context part in the current user message; the state message stays the raw text', async () => {
    state.data = oneSet();
    const human = new HumanMessage({ content: 'ещё подход', id: 'h1' });
    const { requests, out } = await run([...history0(), human], { now: T1, lastUserMessageAt: T0.toISOString() });
    const r = requests[0]!;

    // The wire request carries the volatile context inside the current human message…
    const currentUser = r.messages[lastHumanIndex(r)]!;
    expect(wireText(currentUser)).toContain('<context>');
    expect(wireText(currentUser)).toContain('WORKOUT OVERVIEW');
    expect(wireText(currentUser)).toContain('ещё подход');

    // …while nothing the node hands back to the checkpoint, and no input message, was rewritten.
    expect(human.content).toBe('ещё подход');
    for (const m of out.messages) {
      expect(JSON.stringify(m.content)).not.toContain('<context>');
    }
  });
});

describe('AC-PC-1 + AC-LPF-8: the real training phase with the LOAD_PLAN flags on (v12, LOAD PLAN v2)', () => {
  async function twoTurns(): Promise<{ r1: WireRequest; r2: WireRequest }> {
    let sets = 0;
    const { spec, deps } = makeLoadPlanTrainingSpec(() => loadPlanTrainingData(sets));
    const first = await run([...history0(), new HumanMessage({ content: 'жим ногами 120 на 12', id: 'h1' })], {
      now: T0,
      spec,
      deps,
    });
    // Between the turns: log_set stored a decision-critical set without RPE — its RESULT carries the effort hint.
    sets = 1;
    const second = await run(
      [
        ...history0(),
        new HumanMessage({ content: 'жим ногами 120 на 12', id: 'h1' }),
        new AIMessage({
          content: '',
          id: 'a1',
          tool_calls: [{ id: 'c1', name: 'log_set', args: {}, type: 'tool_call' }],
        }),
        new ToolMessage({ tool_call_id: 'c1', content: EFFORT_HINT_RESULT, id: 't1' }),
        new AIMessage({ content: 'Записал. Сколько ещё раз смог бы сделать на этом весе?', id: 'a2' }),
        new HumanMessage({ content: 'пару раз ещё мог', id: 'h2' }),
      ],
      { now: T1, lastUserMessageAt: T0.toISOString(), spec, deps },
    );
    return { r1: first.requests[0]!, r2: second.requests[0]! };
  }

  it('the system message is byte-identical across the two turns, and it is the v12 prompt', async () => {
    const { r1, r2 } = await twoTurns();
    expect(JSON.stringify(r2.messages[0])).toBe(JSON.stringify(r1.messages[0]));
    expect(wireText(r1.messages[0]!)).toContain('Effort in plain language');
    expect(JSON.stringify(r2.tools)).toBe(JSON.stringify(r1.tools));
  });

  it('LOAD PLAN rides in the <context> part of the CURRENT user message — never in the system message or the history prefix', async () => {
    const { r1, r2 } = await twoTurns();
    for (const r of [r1, r2]) {
      const current = wireText(r.messages[lastHumanIndex(r)]!);
      expect(current).toContain('<context>');
      expect(current).toContain('=== LOAD PLAN');
      expect(current).toContain('next step:');
      const before = r.messages.slice(0, lastHumanIndex(r)).map(wireText).join('\n');
      expect(before).not.toContain('=== LOAD PLAN');
      // (the system prompt itself explains the <context> part, so only the history messages are checked for it)
      expect(r.messages.slice(1, lastHumanIndex(r)).map(wireText).join('\n')).not.toContain('<context>');
    }
  });

  it('the turn after the effort hint keeps the prefix: the hint sits in the history, the cached prefix before it is unchanged', async () => {
    const { r1, r2 } = await twoTurns();
    const prefix1 = r1.messages.slice(0, lastHumanIndex(r1));
    expect(JSON.stringify(r2.messages.slice(0, prefix1.length))).toBe(JSON.stringify(prefix1));
    expect(r2.messages.map(wireText).join('\n')).toContain('Effort hint:');
  });
});
