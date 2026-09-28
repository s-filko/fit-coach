import { EvalCaseSchema, parseCases } from '../case.schema';

const minimalCase = {
  id: 'CH-0001',
  phase: 'chat',
  tags: ['transition'],
  fixture: { user: { languageCode: 'ru', timezone: 'Europe/Berlin' } },
  input: { text: 'давай потренируемся' },
  expect: { tools: { must: ['request_transition'] } },
};

describe('EvalCaseSchema (AC-1303, PROMPT_EVAL_FRAMEWORK §3 case schema)', () => {
  it('accepts a minimal case', () => {
    expect(() => EvalCaseSchema.parse(minimalCase)).not.toThrow();
  });

  it('rejects an unknown phase', () => {
    expect(() => EvalCaseSchema.parse({ ...minimalCase, phase: 'cooking' })).toThrow();
  });

  it('rejects a case with no id', () => {
    const { id: _id, ...noId } = minimalCase;
    expect(() => EvalCaseSchema.parse(noId)).toThrow();
  });

  it('defaults deprecated to false (BR-EVAL-001 case immutability marker)', () => {
    expect(EvalCaseSchema.parse(minimalCase).deprecated).toBe(false);
  });

  it('parses JSONL, skipping blank lines', () => {
    const jsonl = `${JSON.stringify(minimalCase)}\n\n${JSON.stringify({ ...minimalCase, id: 'CH-0002' })}\n`;
    const cases = parseCases(jsonl);
    expect(cases.map(c => c.id)).toEqual(['CH-0001', 'CH-0002']);
  });

  it('reports the offending line number on a malformed case', () => {
    const jsonl = `${JSON.stringify(minimalCase)}\n{"id":"broken"}\n`;
    expect(() => parseCases(jsonl)).toThrow(/line 2/);
  });
});

describe('seed message schema and binding rule (P4 Task 1 — tool seeds, AC-1344 prep)', () => {
  it('accepts tool_call and tool_result seed messages', () => {
    const withTools = {
      ...minimalCase,
      state: {
        phase: 'chat',
        messages: [
          { role: 'human', text: 'hi' },
          { role: 'tool_call', name: 'search_exercises', args: { query: 'chest' } },
          { role: 'tool_result', text: 'Found 1 exercises:' },
        ],
      },
    };
    expect(() => EvalCaseSchema.parse(withTools)).not.toThrow();
  });

  it('rejects a tool_call without a name', () => {
    expect(() =>
      EvalCaseSchema.parse({
        ...minimalCase,
        state: { messages: [{ role: 'tool_call', args: {} }] },
      }),
    ).toThrow();
  });

  it('binds seed ids: tool_call without id gets seed-call-<n> (1-based per case)', () => {
    const cases = parseCases(
      JSON.stringify({
        ...minimalCase,
        state: {
          messages: [
            { role: 'tool_call', name: 'a', args: {} },
            { role: 'tool_call', name: 'b', args: {} },
          ],
        },
      }),
    );
    expect(cases[0]?.state?.messages.map(m => (m.role === 'tool_call' ? m.id : null))).toEqual([
      'seed-call-1',
      'seed-call-2',
    ]);
  });

  it('keeps an explicit tool_call id and does not renumber later calls after it', () => {
    const cases = parseCases(
      JSON.stringify({
        ...minimalCase,
        state: {
          messages: [
            { role: 'tool_call', name: 'a', args: {}, id: 'my-id' },
            { role: 'tool_call', name: 'b', args: {} },
          ],
        },
      }),
    );
    expect(cases[0]?.state?.messages.map(m => (m.role === 'tool_call' ? m.id : null))).toEqual([
      'my-id',
      'seed-call-2',
    ]);
  });

  it('binds a tool_result without toolCallId to the most recent unbound tool_call', () => {
    const cases = parseCases(
      JSON.stringify({
        ...minimalCase,
        state: {
          messages: [
            { role: 'tool_call', name: 'a', args: {} },
            { role: 'tool_call', name: 'b', args: {} },
            { role: 'tool_result', text: 'r1' },
            { role: 'tool_result', text: 'r2' },
          ],
        },
      }),
    );
    const results = cases[0]?.state?.messages.filter(m => m.role === 'tool_result') ?? [];
    expect(results.map(m => (m.role === 'tool_result' ? m.toolCallId : null))).toEqual(['seed-call-2', 'seed-call-1']);
  });

  it('keeps an explicit tool_result toolCallId', () => {
    const cases = parseCases(
      JSON.stringify({
        ...minimalCase,
        state: {
          messages: [
            { role: 'tool_call', name: 'a', args: {} },
            { role: 'tool_result', text: 'r', toolCallId: 'explicit' },
          ],
        },
      }),
    );
    expect(cases[0]?.state?.messages[1]).toMatchObject({ role: 'tool_result', toolCallId: 'explicit' });
  });

  it('still parses legacy human/ai-only messages (existing datasets unchanged)', () => {
    const cases = parseCases(
      JSON.stringify({
        ...minimalCase,
        state: {
          messages: [
            { role: 'human', text: 'q' },
            { role: 'ai', text: 'a' },
          ],
        },
      }),
    );
    expect(cases[0]?.state?.messages).toEqual([
      { role: 'human', text: 'q' },
      { role: 'ai', text: 'a' },
    ]);
  });

  it('types fixture.facts — category from ADR-0009, optional nullable muscleGroup (P6 Task 6)', () => {
    const withFacts = {
      ...minimalCase,
      fixture: {
        ...minimalCase.fixture,
        facts: [
          { category: 'physical_constraint', fact: 'Травмировано правое плечо', muscleGroup: 'shoulders_front' },
          { category: 'exercise_preference', fact: 'Предпочитает гантели штангам', muscleGroup: null },
        ],
      },
    };
    expect(() => EvalCaseSchema.parse(withFacts)).not.toThrow();
  });

  it('rejects an unknown fact category in fixture.facts', () => {
    const badCategory = {
      ...minimalCase,
      fixture: {
        ...minimalCase.fixture,
        facts: [{ category: 'made_up', fact: 'x', muscleGroup: null }],
      },
    };
    expect(() => EvalCaseSchema.parse(badCategory)).toThrow();
  });
});
