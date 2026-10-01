/**
 * AC-LPF-12 (c) at the block level: over seeded generated histories every strength row of the v2 block carries a
 * `next step:` line, the recommend/conservative lines never print a 0 or negative load, and the line is never empty.
 */
import { defaultProgression } from '@domain/training/load-plan';
import { factsOf, generateCase } from '@domain/training/load-plan/__tests__/history-generator';
import { NOW, TZ } from '@domain/training/load-facts/__tests__/fixtures';

import type { LoadPlanEntry } from '@infra/ai/load-facts/load-facts.loader';

import { renderLoadPlanEntryV2 } from '../training-load-plan.v2';

const ctx = { now: NOW, timezone: TZ, user: null };

describe('AC-LPF-12 · generated histories through the v2 block', () => {
  it('every row has a non-empty `next step:` and no non-positive load', () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const c = generateCase(seed);
      const entry = { exercise: c.exercise, facts: factsOf(c) } as LoadPlanEntry;
      const text = renderLoadPlanEntryV2(entry, ctx, { progression: defaultProgression(null) });
      const next = text.split('\n').find(l => l.trim().startsWith('next step:'));
      if (!next || next.trim().length <= 'next step:'.length + 1) {
        problems.push(`seed ${seed}: no next step`);
      }
      if (/(recommend|conservative): (0|-\d)/.test(text.replace(/\n\s+/g, '\n'))) {
        problems.push(`seed ${seed}: non-positive load`);
      }
    }
    expect(problems).toEqual([]);
  });
});
