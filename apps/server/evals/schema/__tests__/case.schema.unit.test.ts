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
