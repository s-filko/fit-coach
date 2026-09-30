/**
 * Prompt-caching plan (BUG-051) T2 — red tests AC-PC-3: `cache_control` breakpoints behind LLM_PROMPT_CACHE
 * (D1, D6) over the serialised request. Red until T4; then renamed `*.unit.test.ts`. Interface: plan § Evidence T2.
 */
import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import { cacheControlParts, wireText } from '../../../context/__tests__/request-capture';

import { history0, lastHumanIndex, noSets, run, state, T0 } from './prompt-cache-harness';

jest.mock('@infra/ai/model.factory', () => ({
  getModel: () => (jest.requireActual('./prompt-cache-harness') as typeof import('./prompt-cache-harness')).state.model,
}));
jest.mock('@config/index', () => {
  const actual = jest.requireActual('@config/index');
  const { state } = jest.requireActual('./prompt-cache-harness') as typeof import('./prompt-cache-harness');
  return { ...actual, loadConfig: () => ({ ...actual.loadConfig(), ...state.config }) };
});
jest.mock('@shared/logger', () => {
  const fns = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => fns };
});

beforeEach(() => {
  state.config = {};
  state.data = noSets();
});

describe('AC-PC-3: cache_control breakpoints behind LLM_PROMPT_CACHE (D1, D6)', () => {
  const messages = () => [...history0(), new HumanMessage({ content: 'жим 60 на 8', id: 'h1' })];

  it('AC-PC-3: anthropic/5m → exactly two breakpoints: last system part and last history message', async () => {
    state.config = { LLM_PROMPT_CACHE: 'anthropic', LLM_PROMPT_CACHE_TTL: '5m' };
    const { requests } = await run(messages(), { now: T0 });
    const r = requests[0]!;
    const parts = cacheControlParts(r);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.messageIndex).toBe(0);
    expect(r.messages[0]!.role).toBe('system');
    // Breakpoint 2 = the last message of history = the one right before the current human message.
    expect(parts[1]!.messageIndex).toBe(lastHumanIndex(r) - 1);
    expect(wireText(r.messages[parts[1]!.messageIndex]!)).toContain('Начинаем');
    expect(parts.map(p => p.part)).toEqual([{ type: 'ephemeral' }, { type: 'ephemeral' }]);
  });

  it('AC-PC-3: anthropic/1h → both breakpoints carry ttl "1h"', async () => {
    state.config = { LLM_PROMPT_CACHE: 'anthropic', LLM_PROMPT_CACHE_TTL: '1h' };
    const { requests } = await run(messages(), { now: T0 });
    const parts = cacheControlParts(requests[0]!);
    expect(parts.map(p => p.part)).toEqual([
      { type: 'ephemeral', ttl: '1h' },
      { type: 'ephemeral', ttl: '1h' },
    ]);
  });

  it('AC-PC-3: off (and the default) → no cache_control anywhere in the body', async () => {
    state.config = { LLM_PROMPT_CACHE: 'off' };
    const off = await run(messages(), { now: T0 });
    expect(JSON.stringify(off.requests[0])).not.toContain('cache_control');
    state.config = {};
    const dflt = await run(messages(), { now: T0 });
    expect(JSON.stringify(dflt.requests[0])).not.toContain('cache_control');
  });

  it('AC-PC-3: the two-breakpoint layout survives a post-tool call — none on the in-flight messages', async () => {
    state.config = { LLM_PROMPT_CACHE: 'anthropic', LLM_PROMPT_CACHE_TTL: '5m' };
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
    const r = requests[0]!;
    const parts = cacheControlParts(r);
    expect(parts).toHaveLength(2);
    expect(parts[1]!.messageIndex).toBeLessThan(lastHumanIndex(r));
  });
});
