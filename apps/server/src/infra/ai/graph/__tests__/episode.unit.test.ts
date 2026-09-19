import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import { runAiText, splitEpisode, toTranscriptMessages } from '../episode';

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

describe("runAiText (AC-CC-3 — the run's reply: every non-empty AI text of THIS run)", () => {
  const call = new AIMessage({
    content: '',
    tool_calls: [{ id: 'c1', name: 'log_set', args: {}, type: 'tool_call' }],
  });
  const result = new ToolMessage({ tool_call_id: 'c1', content: 'ok' });

  it('a run with text + tool calls + final text delivers BOTH texts, in order, blank line between', () => {
    const run = [
      new HumanMessage('сделал жим 80 на 8'),
      new AIMessage('Записал!'),
      call,
      result,
      new AIMessage('Отлично, есть первый подход!'),
    ];
    expect(runAiText(run)).toBe('Записал!\n\nОтлично, есть первый подход!');
  });

  it('AI messages with only tool calls / empty text contribute nothing', () => {
    const run = [new HumanMessage('q'), new AIMessage(''), call, result, new AIMessage('Ответ')];
    expect(runAiText(run)).toBe('Ответ');
  });

  it('texts from earlier runs (before the last HumanMessage) are never re-sent', () => {
    const earlier = [new HumanMessage('q1'), new AIMessage('старый ответ')];
    const run = [new HumanMessage('q2'), new AIMessage('новый ответ')];
    expect(runAiText([...earlier, ...run])).toBe('новый ответ');
  });

  it("a single-AI-message run delivers exactly that message's text, unchanged", () => {
    const run = [new HumanMessage('q'), new AIMessage('  Ответ  ')];
    expect(runAiText(run)).toBe('  Ответ  ');
  });

  it('no AI message at all → empty string', () => {
    expect(runAiText([new HumanMessage('q')])).toBe('');
    expect(runAiText([])).toBe('');
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
