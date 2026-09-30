/**
 * Prompt-caching plan (BUG-051) D1/D6: applyCacheBreakpoints — the two explicit breakpoints on the assembled
 * request. Pure over LangChain messages; the wire shape is asserted in prompt-cache-breakpoints.unit.test.ts.
 */
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

import { applyCacheBreakpoints } from '../cache-breakpoints';

type Part = { type: string; text?: string; cache_control?: unknown };
const partsOf = (m: BaseMessage): Part[] => m.content as Part[];
const marked = (messages: BaseMessage[]): number[] =>
  messages.flatMap((m, i) => (Array.isArray(m.content) && partsOf(m).some(p => p.cache_control) ? [i] : []));

const SYSTEM = new SystemMessage('stable system text');

describe('applyCacheBreakpoints', () => {
  it('marks the last part of the system message and the last history message; nothing after it', () => {
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
    expect(partsOf(out[0]!)).toEqual([
      { type: 'text', text: 'stable system text', cache_control: { type: 'ephemeral' } },
    ]);
    expect(partsOf(out[2]!)).toEqual([{ type: 'text', text: 'a0', cache_control: { type: 'ephemeral' } }]);
  });

  it('1h → ttl "1h" on both', () => {
    const out = applyCacheBreakpoints(
      [SYSTEM, new HumanMessage('h0'), new AIMessage('a0'), new HumanMessage('h1')],
      1,
      '1h',
    );
    expect(marked(out)).toEqual([0, 2]);
    expect(partsOf(out[0]!)[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(partsOf(out[2]!)[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('a ToolMessage can hold breakpoint 2 (T1 probe); a tool-calls-only AIMessage falls back to an earlier message with text', () => {
    const tool = new ToolMessage({ tool_call_id: 'c1', content: 'result' });
    const callOnly = new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 't', args: {}, type: 'tool_call' }] });
    expect(
      marked(applyCacheBreakpoints([SYSTEM, new HumanMessage('h0'), callOnly, tool, new HumanMessage('h1')], 1, '5m')),
    ).toEqual([0, 3]);
    expect(
      marked(applyCacheBreakpoints([SYSTEM, new HumanMessage('h0'), callOnly, new HumanMessage('h1')], 1, '5m')),
    ).toEqual([0, 1]);
  });

  it('no history → only the system breakpoint', () => {
    expect(marked(applyCacheBreakpoints([SYSTEM, new HumanMessage('h1')], 1, '5m'))).toEqual([0]);
  });

  it('never mutates the input messages (history is the checkpointed objects) and keeps ids and tool calls', () => {
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
