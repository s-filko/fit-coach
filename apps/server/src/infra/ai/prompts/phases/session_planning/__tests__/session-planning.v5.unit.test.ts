import { compose } from '@infra/ai/prompts/compose';
import { PHASE_PROMPTS } from '@infra/ai/prompts/index';

import { SESSION_PLANNING_PROMPT_V5 } from '../index';
import { SESSION_PLANNING_V4 } from '../v4';
import { SESSION_PLANNING_V5 } from '../v5';

const RENDER_CTX = {
  now: new Date('2026-10-01T08:00:00Z'),
  timezone: 'Europe/Berlin',
  client: 'telegram' as const,
  user: null,
  lastMessageTime: null,
  context: { daysSinceLastWorkout: 3 },
};

function textOf(module: { render: (ctx: never) => { id: string; text: string }[] }): string {
  return compose(module.render(RENDER_CTX as never) as never);
}

/**
 * v5 (load-plan plan Task 5b, D10, AC-LP-7): v4 minus any instruction to propose or save weights —
 * the session plan is sets × reps only; loads come from LOAD PLAN during training. Selected only
 * with LOAD_PLAN_PLANNER_REBIND on.
 */
describe('phase.session_planning v5 — no weights in the plan (load-plan plan Task 5b, AC-LP-7)', () => {
  it('the registry current stays v4; v5 is a separately registered module and entry', () => {
    expect(PHASE_PROMPTS.session_planning.current.version).toBe('v4');
    expect(SESSION_PLANNING_V5.id).toBe('phase.session_planning');
    expect(SESSION_PLANNING_V5.version).toBe('v5');
    expect(SESSION_PLANNING_PROMPT_V5.current).toBe(SESSION_PLANNING_V5);
    expect(SESSION_PLANNING_PROMPT_V5.requiredSections).toEqual(PHASE_PROMPTS.session_planning.requiredSections);
  });

  it('every section except task is byte-identical to v4', () => {
    const v4 = new Map(SESSION_PLANNING_V4.render(RENDER_CTX).map(s => [s.id, s.text]));
    const v5 = new Map(SESSION_PLANNING_V5.render(RENDER_CTX).map(s => [s.id, s.text]));
    expect([...v5.keys()].sort()).toEqual([...v4.keys()].sort());
    for (const id of v5.keys()) {
      if (id === 'task') {
        expect(v5.get(id)).not.toBe(v4.get(id));
      } else {
        expect(v5.get(id)).toBe(v4.get(id));
      }
    }
  });

  it('differs from v4 only in the weight-instruction lines', () => {
    const markers = [
      // v4-only (removed)
      'adapt intensity (reduce weights, add warm-up sets)',
      'The exercise list with IDs from search results, sets, reps, rest times.',
      // v5-only (added)
      'adapt intensity (reduce intensity, add warm-up sets)',
      'no weights: loads are not planned here',
    ];
    const count = (lines: string[]) => {
      const byLine = new Map<string, number>();
      for (const line of lines) {
        byLine.set(line, (byLine.get(line) ?? 0) + 1);
      }
      return byLine;
    };
    const v4Lines = count(textOf(SESSION_PLANNING_V4).split('\n'));
    const v5Lines = count(textOf(SESSION_PLANNING_V5).split('\n'));
    const differing = new Set([...v4Lines.keys(), ...v5Lines.keys()].filter(l => v4Lines.get(l) !== v5Lines.get(l)));
    expect(differing.size).toBeGreaterThan(0);
    for (const line of differing) {
      expect(markers.some(m => line.includes(m))).toBe(true);
    }
  });

  it('STEP 3 proposes sets × reps only and says where loads come from', () => {
    const task = SESSION_PLANNING_V5.render(RENDER_CTX).find(s => s.id === 'task')!.text;
    const step3 = /STEP 3: SEARCH AND PROPOSE THE PLAN[^]*?(?=--- STEP 4)/.exec(task);
    expect(step3).not.toBeNull();
    expect(step3![0]).toContain('sets, reps, rest times — sets × reps only, no weights: loads are not planned here');
    expect(step3![0]).toContain('the training phase decides them from LOAD PLAN');
  });
});
