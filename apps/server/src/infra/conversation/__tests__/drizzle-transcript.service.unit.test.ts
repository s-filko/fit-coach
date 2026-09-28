import { toTurnRows } from '../drizzle-transcript.service';

const INPUT = {
  userId: 'u-1',
  runId: 'run-1',
  phase: 'plan_creation' as const,
  episodeId: 'ep-1',
};

/** Rows without the shared (userId, phase, runId) prefix — what varies per D-K. */
const varying = (rows: ReturnType<typeof toTurnRows>) =>
  rows.map(({ kind, role, content, payload }) => ({ kind, role, content, payload }));

describe('toTurnRows — transcript projection per message (D-K, ADR-0013 §8)', () => {
  it('projects a human message as kind human, role user', () => {
    const rows = varying(
      toTurnRows({
        ...INPUT,
        messages: [{ kind: 'human', text: 'составь план' }],
      }),
    );
    expect(rows).toEqual([{ kind: 'human', role: 'user', content: 'составь план', payload: null }]);
  });

  it('projects an ai message with text as kind ai, role assistant', () => {
    const rows = varying(
      toTurnRows({
        ...INPUT,
        messages: [{ kind: 'ai', text: 'Предлагаю…' }],
      }),
    );
    expect(rows).toEqual([{ kind: 'ai', role: 'assistant', content: 'Предлагаю…', payload: null }]);
  });

  it('derives role system for a textless ai message (tool-call-only) — INV: a P3 rollback sees only real user/assistant text', () => {
    const rows = varying(
      toTurnRows({
        ...INPUT,
        messages: [
          { kind: 'ai', text: '', toolCalls: [{ id: 'call-1', name: 'search_exercises', args: { query: 'chest' } }] },
        ],
      }),
    );
    expect(rows).toEqual([
      {
        kind: 'ai',
        role: 'system',
        content: '',
        payload: { tool_calls: [{ id: 'call-1', name: 'search_exercises', args: { query: 'chest' } }] },
      },
      {
        kind: 'tool_call',
        role: 'system',
        content: 'search_exercises',
        payload: { tool_call_id: 'call-1', args: { query: 'chest' } },
      },
    ]);
  });

  it('projects one tool_call row per call, content = tool name', () => {
    const rows = varying(
      toTurnRows({
        ...INPUT,
        messages: [
          {
            kind: 'ai',
            text: '',
            toolCalls: [
              { id: 'a', name: 'log_set', args: { reps: 8 } },
              { id: 'b', name: 'log_set', args: { reps: 6 } },
            ],
          },
        ],
      }),
    );
    expect(rows.filter(r => r.kind === 'tool_call')).toEqual([
      { kind: 'tool_call', role: 'system', content: 'log_set', payload: { tool_call_id: 'a', args: { reps: 8 } } },
      { kind: 'tool_call', role: 'system', content: 'log_set', payload: { tool_call_id: 'b', args: { reps: 6 } } },
    ]);
  });

  it('projects a tool_result with status and tool_call_id in payload', () => {
    const rows = varying(
      toTurnRows({
        ...INPUT,
        messages: [{ kind: 'tool_result', toolCallId: 'a', text: 'Set logged', status: 'ok' }],
      }),
    );
    expect(rows).toEqual([
      { kind: 'tool_result', role: 'system', content: 'Set logged', payload: { tool_call_id: 'a', status: 'ok' } },
    ]);
  });

  it('stamps every row with userId, phase, runId and episodeId-independent identity (BUG-016: run_id never null)', () => {
    const rows = toTurnRows({
      ...INPUT,
      messages: [{ kind: 'human', text: 'hi' }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'u-1', phase: 'plan_creation', runId: 'run-1' });
  });

  it('returns an empty array for an empty run', () => {
    expect(toTurnRows({ ...INPUT, messages: [] })).toEqual([]);
  });

  it('INV-LLM-010: numbers its rows 1..n in message order by default', () => {
    const rows = toTurnRows({
      ...INPUT,
      messages: [
        { kind: 'human', text: 'hi' },
        // The ai message + its one tool call project to TWO rows (D-K) — the
        // row count, not the message count, is what seq numbers.
        { kind: 'ai', text: '', toolCalls: [{ id: 'a', name: 'log_set', args: {} }] },
        { kind: 'tool_result', toolCallId: 'a', text: 'done', status: 'ok' },
      ],
    });
    expect(rows.map(r => r.seq)).toEqual([1, 2, 3, 4]);
  });

  it('INV-LLM-010: startSeq continues the numbering instead of restarting at 1', () => {
    const rows = toTurnRows(
      {
        ...INPUT,
        messages: [
          { kind: 'ai', text: 'answer' },
          { kind: 'ai', text: 'more' },
        ],
      },
      5,
    );
    expect(rows.map(r => r.seq)).toEqual([5, 6]);
  });
});
