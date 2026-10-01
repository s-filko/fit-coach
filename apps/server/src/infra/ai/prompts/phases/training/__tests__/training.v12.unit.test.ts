import { compose } from '@infra/ai/prompts/compose';

import { TRAINING_PROMPT_V12 } from '../index';
import { TRAINING_V11 } from '../v11';
import { TRAINING_V12 } from '../v12';

const RENDER_CTX = {
  now: new Date('2026-10-01T08:00:00Z'),
  timezone: 'Europe/Berlin',
  client: 'telegram' as const,
  user: null,
  lastMessageTime: null,
};

const textOf = (module: { render: (ctx: never) => { id: string; text: string }[] }): string =>
  compose(module.render(RENDER_CTX as never) as never);

/**
 * v12 (load-plan-fixes item 3, AC-LPF-3, BR-LLM-008 — a wording change is a new version file): v11 plus one rule-1
 * clarification. The LOAD PLAN may now say `no number` / `no conservative option` (no record and no reference load);
 * the coach then says so and invents neither a load nor a conservative option (replay U2: the same load twice,
 * presented as "conservative"). Everything else is byte-identical to v11.
 */
describe('phase.training v12 — no invented conservative option (AC-LPF-3)', () => {
  it('is a separately registered module and entry; v11 stays untouched', () => {
    expect(TRAINING_V12.id).toBe('phase.training');
    expect(TRAINING_V12.version).toBe('v12');
    expect(TRAINING_PROMPT_V12.current).toBe(TRAINING_V12);
    expect(TRAINING_V11.version).toBe('v11');
    expect(textOf(TRAINING_V11)).not.toContain('no conservative option');
  });

  it('every section except task is byte-identical to v11', () => {
    const v11 = new Map(TRAINING_V11.render(RENDER_CTX).map(s => [s.id, s.text]));
    const v12 = new Map(TRAINING_V12.render(RENDER_CTX).map(s => [s.id, s.text]));
    expect([...v12.keys()].sort()).toEqual([...v11.keys()].sort());
    for (const id of v12.keys()) {
      if (id === 'task') {
        expect(v12.get(id)).not.toBe(v11.get(id));
      } else {
        expect(v12.get(id)).toBe(v11.get(id));
      }
    }
  });

  it('rule 1 forbids inventing a conservative option or a load when the block gives none', () => {
    const task = TRAINING_V12.render(RENDER_CTX).find(s => s.id === 'task')!.text;
    const [rule1] = /1\. <b>First set of each exercise<\/b>[^]*?(?=\n2\. )/.exec(task)!;
    expect(rule1).toContain('no conservative option');
    expect(rule1).toContain('do not invent one');
    expect(rule1).toContain('no number');
    expect(rule1).not.toContain('Always show the `conservative:` option as the alternative.');
    expect(rule1).not.toContain('suggest a conservative start');
  });

  it('tells the coach a "no lighter option" conservative line means the load is the lightest, not a variant', () => {
    const task = TRAINING_V12.render(RENDER_CTX).find(s => s.id === 'task')!.text;
    expect(task).toContain('no lighter option');
    expect(task).toContain('the lightest');
    expect(task).toContain('never present the same load as a conservative variant');
  });

  it('AC-LPF-8: tells the coach to explain the load and name the next step', () => {
    const task = TRAINING_V12.render(RENDER_CTX).find(s => s.id === 'task')!.text;
    expect(task).toContain('Explain the load');
    expect(task).toContain('`next step:`');
    expect(task).toContain("below the client's recent best");
    expect(task).toContain('say plainly why it is lower and when it will rise');
  });

  it('AC-LPF-8: cautiously optimistic — offers a block step with a fallback, never pressures or invents a step', () => {
    const task = TRAINING_V12.render(RENDER_CTX).find(s => s.id === 'task')!.text;
    expect(task).toContain('cautiously optimistic');
    expect(task).toContain('as the fallback');
    expect(task).toContain('never promise one, never pressure the client');
    expect(task).toContain('never invent a step the block does not offer');
    expect(task).toContain('encouragement; it never changes the load');
  });

  it('AC-LPF-8: in-session hint — a set ≥ 3 reps above the top or below the floor → one step for the NEXT set', () => {
    const task = TRAINING_V12.render(RENDER_CTX).find(s => s.id === 'task')!.text;
    const [hint] = /In-session hint:[^\n]*/.exec(task)!;
    expect(hint).toContain('at least 3 reps above the top');
    expect(hint).toContain('below its floor');
    expect(hint).toContain('for the NEXT set only, one step at a time');
  });

  it('AC-LPF-11: plain-language effort question, phrase → RPE mapping, RPE term only if the user uses it, kept as a fact', () => {
    const task = TRAINING_V12.render(RENDER_CTX).find(s => s.id === 'task')!.text;
    const [rule] = /Effort in plain language:[^\n]*/.exec(task)!;
    expect(rule).toContain('Сколько ещё раз смог бы сделать на этом весе? 0, 1–2 или 3 и больше?');
    expect(rule).toContain('`Effort hint`');
    expect(rule).toContain('never ask on your own initiative');
    expect(rule).toMatch(/«еле дожал» → 10.*«ещё пару мог» → 8.*«боялся без страховки, силы были» → 7/);
    expect(rule).toContain('Use the term RPE only if the client does');
    expect(rule).toContain('explain it in one line only when asked');
    expect(rule).toContain('manage_fact, category coaching_preference');
  });

  it('v11 carries none of the expectation-management rules', () => {
    const v11 = textOf(TRAINING_V11);
    expect(v11).not.toContain('Explain the load');
    expect(v11).not.toContain('In-session hint');
    expect(v11).not.toContain('Effort in plain language');
  });

  it('differs from v11 only in rule 1 (two lines + three added lines) and rule 4b', () => {
    const lines = (t: string): string[] => t.split('\n');
    const v11 = new Set(lines(textOf(TRAINING_V11)));
    const added = lines(textOf(TRAINING_V12)).filter(l => !v11.has(l));
    expect(added).toHaveLength(6);
    expect(added.some(l => l.includes('First set of each exercise'))).toBe(true);
    expect(added.some(l => l.includes('Then give a specific recommendation'))).toBe(true);
    expect(added.some(l => l.includes('Explain the load:'))).toBe(true);
    expect(added.some(l => l.includes('In-session hint:'))).toBe(true);
    expect(added.some(l => l.includes('Effort in plain language:'))).toBe(true);
    expect(added.some(l => l.includes('b) The user explicitly asked to move on'))).toBe(true);
  });
});
