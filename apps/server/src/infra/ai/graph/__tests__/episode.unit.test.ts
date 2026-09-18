import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import { lastAiText, splitEpisode, toTranscriptMessages } from '../episode';

describe('splitEpisode (D-I — this run = from the last HumanMessage on; INV-LLM-002)', () => {
  it('splits on the single human message', () => {
    const messages = [new HumanMessage('q'), new AIMessage('a')];
    expect(splitEpisode(messages)).toEqual({ history: [], current: messages });
  });

  it('history = everything before the LAST human (two runs in the channel)', () => {
    const first = [new HumanMessage('q1'), new AIMessage('a1')];
    const second = [new HumanMessage('q2'), new AIMessage('a2')];
    const { history, current } = splitEpisode([...first, ...second]);
    expect(history).toEqual(first);
    expect(current).toEqual(second);
  });

  it('tool traffic between runs belongs to history, never split from its call', () => {
    const call = new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'log_set', args: {} }] });
    const result = new ToolMessage({ tool_call_id: 'c1', content: 'ok' });
    const first = [new HumanMessage('q1'), call, result, new AIMessage('a1')];
    const second = [new HumanMessage('q2')];
    const { history, current } = splitEpisode([...first, ...second]);
    expect(history).toEqual(first);
    expect(current).toEqual(second);
  });

  it('returns current = [] when there is no human message', () => {
    const messages = [new AIMessage('a')];
    expect(splitEpisode(messages)).toEqual({ history: messages, current: [] });
  });
});

describe('lastAiText', () => {
  it('returns the text of the last AI message', () => {
    expect(lastAiText([new HumanMessage('q'), new AIMessage('first'), new AIMessage('last')])).toBe('last');
  });

  it('returns null with no AI message', () => {
    expect(lastAiText([new HumanMessage('q')])).toBeNull();
  });
});

describe('toTranscriptMessages (D-K — infra → domain mapping)', () => {
  it('maps human, ai-with-text, ai-with-tools and tool results', () => {
    const call = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'search_exercises', args: { query: 'chest' } }],
    });
    const out = toTranscriptMessages([
      new HumanMessage('найди упражнения'),
      call,
      new ToolMessage({ tool_call_id: 'c1', content: 'Found 1 exercises:' }),
      new AIMessage('Предлагаю жим'),
    ]);
    expect(out).toEqual([
      { kind: 'human', text: 'найди упражнения' },
      { kind: 'ai', text: '', toolCalls: [{ id: 'c1', name: 'search_exercises', args: { query: 'chest' } }] },
      { kind: 'tool_result', toolCallId: 'c1', text: 'Found 1 exercises:', status: 'ok' },
      { kind: 'ai', text: 'Предлагаю жим' },
    ]);
  });

  it('marks an error tool result', () => {
    const out = toTranscriptMessages([
      new ToolMessage({ tool_call_id: 'c1', content: 'SYSTEM_ERROR: db down', status: 'error' }),
    ]);
    expect(out[0]).toMatchObject({ kind: 'tool_result', status: 'error' });
  });
});
