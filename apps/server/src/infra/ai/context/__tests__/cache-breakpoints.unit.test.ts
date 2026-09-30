/**
 * Prompt-caching plan (BUG-051) D1/D6: applyCacheBreakpoints — the two explicit breakpoints on the assembled
 * request. Pure over LangChain messages; the wire shape is asserted in prompt-cache-breakpoints.unit.test.ts.
 */
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

import { applyCacheBreakpoints, partsOf, withParts } from '../cache-breakpoints';

type Part = { type: string; text?: string; cache_control?: unknown };
const contentParts = (m: BaseMessage): Part[] => m.content as Part[];
const marked = (messages: BaseMessage[]): number[] =>
  messages.flatMap((m, i) => (Array.isArray(m.content) && contentParts(m).some(p => p.cache_control) ? [i] : []));

const SYSTEM = new SystemMessage('stable system text');

describe('applyCacheBreakpoints (AC-PC-3)', () => {
  it('AC-PC-3: marks the last part of the system message and the last history message; nothing after it', () => {
    const messages = [
      SYSTEM,
      new HumanMessage('h0'),
      new AIMessage({ content: 'a0', tool_calls: [] }),
      new HumanMessage({
        content: [
          { type: 'text', text: '<context>x</context>' },
          { type: 'text', text: 'h1' },
        ],
      }),
      new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 't', args: {}, type: 'tool_call' }] }),
      new ToolMessage({ tool_call_id: 'c1', content: 'r1' }),
    ];
    const out = applyCacheBreakpoints(messages, 3, '5m');
    expect(marked(out)).toEqual([0, 2]);
    expect(contentParts(out[0]!)).toEqual([
      { type: 'text', text: 'stable system text', cache_control: { type: 'ephemeral' } },
    ]);
    expect(contentParts(out[2]!)).toEqual([{ type: 'text', text: 'a0', cache_control: { type: 'ephemeral' } }]);
  });

  it('AC-PC-3: 1h → ttl "1h" on both', () => {
    const out = applyCacheBreakpoints(
      [SYSTEM, new HumanMessage('h0'), new AIMessage('a0'), new HumanMessage('h1')],
      1,
      '1h',
    );
    expect(marked(out)).toEqual([0, 2]);
    expect(contentParts(out[0]!)[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(contentParts(out[2]!)[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('AC-PC-3: a ToolMessage can hold breakpoint 2 (T1 probe); a tool-calls-only AIMessage falls back to an earlier message with text', () => {
    const tool = new ToolMessage({ tool_call_id: 'c1', content: 'result' });
    const callOnly = new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 't', args: {}, type: 'tool_call' }] });
    expect(
      marked(applyCacheBreakpoints([SYSTEM, new HumanMessage('h0'), callOnly, tool, new HumanMessage('h1')], 1, '5m')),
    ).toEqual([0, 3]);
    expect(
      marked(applyCacheBreakpoints([SYSTEM, new HumanMessage('h0'), callOnly, new HumanMessage('h1')], 1, '5m')),
    ).toEqual([0, 1]);
  });

  it('AC-PC-3: no history → only the system breakpoint', () => {
    expect(marked(applyCacheBreakpoints([SYSTEM, new HumanMessage('h1')], 1, '5m'))).toEqual([0]);
  });

  it('AC-PC-3: never mutates the input messages (history is the checkpointed objects) and keeps ids and tool calls', () => {
    const ai = new AIMessage({
      content: 'a0',
      id: 'ai-1',
      tool_calls: [{ id: 'c1', name: 't', args: { x: 1 }, type: 'tool_call' }],
    });
    const messages = [SYSTEM, new HumanMessage('h0'), ai, new HumanMessage('h1')];
    const out = applyCacheBreakpoints(messages, 1, '5m');
    expect(ai.content).toBe('a0');
    expect(SYSTEM.content).toBe('stable system text');
    expect(out[2]).not.toBe(ai);
    expect((out[2] as AIMessage).id).toBe('ai-1');
    expect((out[2] as AIMessage).tool_calls).toEqual(ai.tool_calls);
    expect(out[3]).toBe(messages[3]);
  });
});

describe('withParts — the one clone-with-new-parts helper (AC-PC-3, review R2)', () => {
  it('AC-PC-3: keeps id, name, additional_kwargs and response_metadata for every role it clones', () => {
    const extras = { id: 'm-1', name: 'n', additional_kwargs: { k: 1 }, response_metadata: { finish_reason: 'stop' } };
    const parts = [{ type: 'text', text: 'new' }];
    const clones = [
      withParts(new HumanMessage({ content: 'x', ...extras }), parts),
      withParts(new SystemMessage({ content: 'x', ...extras }), parts),
      withParts(new ToolMessage({ content: 'x', tool_call_id: 'c1', status: 'error', ...extras }), parts),
      withParts(new AIMessage({ content: 'x', tool_calls: [], ...extras }), parts),
    ];
    for (const clone of clones) {
      expect(clone.id).toBe('m-1');
      expect(clone.name).toBe('n');
      expect(clone.additional_kwargs).toEqual({ k: 1 });
      expect(clone.response_metadata).toEqual({ finish_reason: 'stop' });
      expect(clone.content).toEqual(parts);
    }
    expect((clones[2] as ToolMessage).tool_call_id).toBe('c1');
    expect((clones[2] as ToolMessage).status).toBe('error');
  });

  it('AC-PC-3: partsOf turns a string into one text part and copies a part list', () => {
    expect(partsOf(new HumanMessage('hi'))).toEqual([{ type: 'text', text: 'hi' }]);
    const original = new HumanMessage({ content: [{ type: 'text', text: 'a' }] });
    const copy = partsOf(original);
    copy[0]!.text = 'changed';
    expect((original.content as Array<{ text: string }>)[0]!.text).toBe('a');
  });
});
