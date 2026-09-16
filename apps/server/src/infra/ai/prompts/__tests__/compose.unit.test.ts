import { compose, promptVersionsOf, renderDirectives, SECTION_SEPARATOR, sectionText } from '../compose';
import type { DirectiveModule, PromptModule, Section } from '../types';

const section = (id: string, text: string): Section => ({ id, text, required: true });

const always: DirectiveModule = { id: 'always', version: 'v1', render: () => section('always', 'A') };
const never: DirectiveModule = { id: 'never', version: 'v3', render: () => null };

const ctx = {
  now: new Date('2026-09-13T10:00:00Z'),
  timezone: null,
  client: 'telegram' as const,
  user: null,
  lastMessageTime: null,
};

describe('compose (ADR-0013 §5.2, BR-LLM-007 — deterministic composition)', () => {
  it('joins section texts with exactly one blank line', () => {
    expect(compose([section('a', 'one'), section('b', 'two')])).toBe(`one${SECTION_SEPARATOR}two`);
    expect(SECTION_SEPARATOR).toBe('\n\n');
  });

  it('renderDirectives keeps order and drops directives that render null', () => {
    const rendered = renderDirectives([never, always, never], ctx);
    expect(rendered.map(s => s.id)).toEqual(['always']);
  });

  it('sectionText returns the text by id and throws for a missing id', () => {
    expect(sectionText([section('x', 'X')], 'x')).toBe('X');
    expect(() => sectionText([section('x', 'X')], 'y')).toThrow(/y/);
  });

  it('promptVersionsOf lists the module and every directive as directive.<id> (BR-LLM-008)', () => {
    const module: PromptModule<unknown> = {
      id: 'phase.chat',
      version: 'v1',
      directives: [always, never],
      render: () => [],
    };
    expect(promptVersionsOf(module)).toEqual({ 'phase.chat': 'v1', 'directive.always': 'v1', 'directive.never': 'v3' });
  });
});
