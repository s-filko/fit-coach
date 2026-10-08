/**
 * `TRAINING_COACH_V15` (coach-quality-proof T4, owner decision 2026-10-08 on load vs reps): the second
 * progression candidate. The live v14 measurement grew 2/3 (was 0/3) but after a miss the coach held 100 kg
 * and lowered the rep target in 3/3 — which the owner called a LEGITIMATE choice («не всегда понижение
 * веса… иногда нужно взять максимальный вес, новую планку поставить, сделать меньше повторов, потом повторы,
 * потом подходы 3→4→5»). v15 replaces v14's progression sentence with that fuller principle; everything else
 * is v14 (and so v13) verbatim. Accepted as the default 2026-10-08.
 */
import type { DirectiveContext } from '@infra/ai/prompts/types';

import { TRAINING_COACH, type TrainingCoachContext } from '../coach';
import { TRAINING_COACH_V14, V14_LOAD_RULE } from '../coach.v14';
import { TRAINING_COACH as TRAINING_COACH_DEFAULT, TRAINING_PROMPT } from '../index';
import { deriveV15Template, TRAINING_COACH_V15, V15_LOAD_RULE } from '../coach.v15';

function ctx(languageCode: string | null): TrainingCoachContext {
  return {
    user: { id: 'u1', firstName: 'Alex', languageCode },
    lastMessageTime: null,
    profileFacts: [],
  } as unknown as DirectiveContext & TrainingCoachContext;
}

const textOf = (module: typeof TRAINING_COACH): string =>
  module.render(ctx('ru')).find(s => s.id === 'coach')?.text ?? '';

describe('TRAINING_COACH_V15 (the load-vs-reps candidate)', () => {
  it('is phase.training v15 with the same sections and no directives as v14', () => {
    expect(TRAINING_COACH_V15.id).toBe('phase.training');
    expect(TRAINING_COACH_V15.version).toBe('v15');
    expect(TRAINING_COACH_V15.directives).toEqual([]);
    expect(TRAINING_COACH_V15.render(ctx('ru')).map(s => s.id)).toEqual(['coach', 'profile']);
  });

  it('the full line diff against v14 is exactly the one replaced paragraph (BR-LLM-008)', () => {
    const before = textOf(TRAINING_COACH_V14).split('\n');
    const after = textOf(TRAINING_COACH_V15).split('\n');
    expect(after.join('\n')).toContain(V15_LOAD_RULE);
    expect(after.join('\n')).not.toContain(V14_LOAD_RULE);
    const expectedLine = before.find(line => line.includes(V14_LOAD_RULE))!.replace(V14_LOAD_RULE, V15_LOAD_RULE);
    const changed = after.filter((line, i) => line !== before[i]);
    expect(changed).toEqual([expectedLine]);
    expect(after.length).toBe(before.length);
  });

  // v13 pins 2 500, v14 pins 2 700; v15's growth states its reason: the owner-ordered load-vs-reps
  // principle (2026-10-08) — the fuller paragraph replaces v14's one sentence.
  it('stays within its size pin — 3 050 (v14 is pinned 2 700)', () => {
    expect(textOf(TRAINING_COACH_V15).length).toBeLessThanOrEqual(3050);
    expect(textOf(TRAINING_COACH_V15).length).toBeGreaterThan(2700);
  });

  it('deriveV15Template fails loudly when the v14 needle is missing (stale derivation)', () => {
    expect(() =>
      deriveV15Template(textOf(TRAINING_COACH_V14).replace(V14_LOAD_RULE, 'a different rule entirely')),
    ).toThrow(/needle/);
  });
});

describe('the default training coach prompt', () => {
  it('TRAINING_PROMPT and TRAINING_COACH resolve to v15 (owner accepted 2026-10-08)', () => {
    expect(TRAINING_PROMPT.current).toBe(TRAINING_COACH_V15);
    expect(TRAINING_PROMPT.current.version).toBe('v15');
    expect(TRAINING_COACH_DEFAULT).toBe(TRAINING_COACH_V15);
  });
});
