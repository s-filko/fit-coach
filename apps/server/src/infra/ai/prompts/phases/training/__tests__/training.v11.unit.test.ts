import { compose } from '@infra/ai/prompts/compose';
import { TRAINING_PROMPT_V10 } from '..';

import { TRAINING_PROMPT_V11 } from '../index';
import { TRAINING_V11 } from '../v11';
import { TRAINING_V10 } from '../v10';

const RENDER_CTX = {
  now: new Date('2026-10-01T08:00:00Z'),
  timezone: 'Europe/Berlin',
  client: 'telegram' as const,
  user: null,
  lastMessageTime: null,
};

function textOf(module: { render: (ctx: never) => { id: string; text: string }[] }): string {
  return compose(module.render(RENDER_CTX as never) as never);
}

/**
 * v11 (load-plan plan Task 5b, D10/O1, AC-LP-7): v10 with TASK rules 1, 2, 4b and the FIRST
 * MESSAGE RULE rebound to LOAD PLAN / get_load_plan — the suggestion (recommend:/conservative:)
 * is the coach's starting point, not a binding value (O1); the first working set reports what was
 * advised via log_set `advised`; the session guide shows sets/reps without weight. Everything
 * else is byte-identical to v10.
 */
describe('phase.training v11 — planner rebinding (load-plan plan Task 5b, AC-LP-7)', () => {
  it('the registry current stays v10; v11 is a separately registered module and entry', () => {
    expect(TRAINING_PROMPT_V10.current.version).toBe('v10');
    expect(TRAINING_V11.id).toBe('phase.training');
    expect(TRAINING_V11.version).toBe('v11');
    expect(TRAINING_PROMPT_V11.current).toBe(TRAINING_V11);
    expect(TRAINING_PROMPT_V11.requiredSections).toEqual(TRAINING_PROMPT_V10.requiredSections);
  });

  it('renders the same required sections as v10', () => {
    const ids = TRAINING_V11.render(RENDER_CTX).map(s => s.id);
    for (const required of ['task', 'tools', 'rules', 'directive.tool-reply']) {
      expect(ids).toContain(required);
    }
  });

  it('every section except task and rules is byte-identical to v10', () => {
    const v10 = new Map(TRAINING_V10.render(RENDER_CTX).map(s => [s.id, s.text]));
    const v11 = new Map(TRAINING_V11.render(RENDER_CTX).map(s => [s.id, s.text]));
    expect([...v11.keys()].sort()).toEqual([...v10.keys()].sort());
    for (const id of v11.keys()) {
      if (id === 'task' || id === 'rules') {
        expect(v11.get(id)).not.toBe(v10.get(id));
      } else {
        expect(v11.get(id)).toBe(v10.get(id));
      }
    }
  });

  it('differs from v10 ONLY in the rebound lines (rules 1, 2, 4b, FIRST MESSAGE RULE)', () => {
    // Multiset line diff: every line that is not shared must carry one of the expected markers.
    const markers = [
      // v10-only lines (removed by the rebinding)
      'LOAD PLAN recommends no weight',
      'Call log_set first',
      'Then give a specific recommendation',
      'Keep it brief',
      'Negative feedback (pain / discomfort / dropped bar)',
      '"Too easy" or low RPE',
      'Neutral / no feedback',
      'sets/reps/weight',
      'announce the next exercise from SESSION PLAN with a specific recommendation',
      // v11-only lines (added by the rebinding)
      'recommend:',
      'conservative:',
      'advised',
      'loads are not planned',
      'announce the next exercise from SESSION PLAN with the LOAD PLAN suggestion',
    ];
    const count = (lines: string[]) => {
      const byLine = new Map<string, number>();
      for (const line of lines) {
        byLine.set(line, (byLine.get(line) ?? 0) + 1);
      }
      return byLine;
    };
    const v10Lines = count(textOf(TRAINING_V10).split('\n'));
    const v11Lines = count(textOf(TRAINING_V11).split('\n'));
    const differing = new Set(
      [...v10Lines.keys(), ...v11Lines.keys()].filter(l => v10Lines.get(l) !== v11Lines.get(l)),
    );
    expect(differing.size).toBeGreaterThan(0);
    for (const line of differing) {
      expect(markers.some(m => line.includes(m))).toBe(true);
    }
  });

  it('rule 1 treats the LOAD PLAN suggestion as a starting point and always names the conservative option', () => {
    const task = TRAINING_V11.render(RENDER_CTX).find(s => s.id === 'task')!.text;
    const rule1 = /1\. <b>First set of each exercise<\/b>[^]*?(?=\n2\. )/.exec(task);
    expect(rule1).not.toBeNull();
    expect(rule1![0]).toContain('a suggestion: `recommend:` with its reason and `conservative:`');
    expect(rule1![0]).toContain('not a binding value');
    expect(rule1![0]).toContain('you decide the load by your judgement of the current situation');
    expect(rule1![0]).toContain('when you depart from `recommend:` you say so and give your reason');
    expect(rule1![0]).toContain('Always show the `conservative:` option');
    expect(rule1![0]).toContain('When LOAD PLAN says insufficient data (no completed record)');
    expect(rule1![0]).not.toContain('LOAD PLAN recommends no weight');
  });

  it('rule 2 reports the advice on the first working set via log_set advised', () => {
    const task = TRAINING_V11.render(RENDER_CTX).find(s => s.id === 'task')!.text;
    const rule2 = /2\. <b>After each set<\/b>[^]*?(?=\n3\. )/.exec(task);
    expect(rule2).not.toBeNull();
    expect(rule2![0]).toContain('FIRST working set');
    expect(rule2![0]).toContain('`advised`');
    expect(rule2![0]).toContain('when it differs from the LOAD PLAN suggestion');
  });

  it('rule 4b announces the next exercise with the LOAD PLAN suggestion', () => {
    const task = TRAINING_V11.render(RENDER_CTX).find(s => s.id === 'task')!.text;
    const rule4b = /b\) The user explicitly asked to move on[^]*?If the user completed all planned sets/.exec(task);
    expect(rule4b).not.toBeNull();
    expect(rule4b![0]).toContain('announce the next exercise from SESSION PLAN with the LOAD PLAN suggestion');
  });

  it('the FIRST MESSAGE RULE shows sets/reps without weight', () => {
    const rules = TRAINING_V11.render(RENDER_CTX).find(s => s.id === 'rules')!.text;
    const first = /FIRST MESSAGE RULE:[^\n]*/.exec(rules);
    expect(first).not.toBeNull();
    expect(first![0]).toContain('sets/reps');
    expect(first![0]).not.toContain('weight');
    expect(first![0]).toContain('loads are not planned');
  });
});
