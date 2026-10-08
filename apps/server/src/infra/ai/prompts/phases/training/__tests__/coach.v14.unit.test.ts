/**
 * `TRAINING_COACH_V14` (coach-quality-proof T4 / AC-CQ-4, owner decision 2026-10-08): the weight-progression
 * candidate. v13's only load rule anchored every try to a load already used ("the next load they have used;
 * otherwise a rep or two more") — with the whole history at 80 the model had nothing "next" to use and held, and
 * nothing told it a miss means a step down. v14 replaces that one sentence (BR-LLM-008 derivation: exact-text
 * replacement, loud when the needle is missing) with the progression principle the spec already holds
 * (BR-TRAINING-042 growth, BR-TRAINING-043 down/early-stop hold, the break rule); everything else is v13 verbatim.
 */
import type { DirectiveContext } from '@infra/ai/prompts/types';

import { TRAINING_COACH, type TrainingCoachContext } from '../coach';
import { COACH_TEMPLATE_V13, deriveV14Template, TRAINING_COACH_V14 } from '../coach.v14';

/** The one changed line — the derivation needle (v13) and its replacement (v14). */
export const V13_RULE =
  'When last time topped the rep range with reps to spare, the try is the next load they have used; otherwise a rep or two more.';
export const V14_RULE =
  'The next load follows the history: every set at the top of the range in two workouts in a row — one equipment step up (2.5 kg barbell, 2 per hand dumbbell, 5 stack); below the range’s floor — one step down; short of the floor only with reps in reserve — the same load; after a long break — lighter than before it.';

function ctx(languageCode: string | null): TrainingCoachContext {
  return {
    user: { id: 'u1', firstName: 'Alex', languageCode },
    lastMessageTime: null,
    profileFacts: [],
  } as unknown as DirectiveContext & TrainingCoachContext;
}

const textOf = (module: typeof TRAINING_COACH): string =>
  module.render(ctx('ru')).find(s => s.id === 'coach')?.text ?? '';

describe('TRAINING_COACH_V14 (the progression candidate)', () => {
  it('is phase.training v14 with the same sections and no directives as v13', () => {
    expect(TRAINING_COACH_V14.id).toBe('phase.training');
    expect(TRAINING_COACH_V14.version).toBe('v14');
    expect(TRAINING_COACH_V14.directives).toEqual([]);
    expect(TRAINING_COACH_V14.render(ctx('ru')).map(s => s.id)).toEqual(['coach', 'profile']);
  });

  it('the full line diff against v13 is exactly the one replaced sentence (BR-LLM-008)', () => {
    const before = textOf(TRAINING_COACH).split('\n');
    const after = textOf(TRAINING_COACH_V14).split('\n');
    expect(after.join('\n')).toContain(V14_RULE);
    expect(after.join('\n')).not.toContain(V13_RULE);
    // The sentence sits mid-line in its bullet — the one changed line is v13's
    // line with exactly that sentence replaced, and every other line is verbatim.
    const expectedLine = before.find(line => line.includes(V13_RULE))!.replace(V13_RULE, V14_RULE);
    const changed = after.filter((line, i) => line !== before[i]);
    expect(changed).toEqual([expectedLine]);
    expect(after.length).toBe(before.length);
  });

  // v13 is pinned 2 500; the growth states its reason: the owner-ordered progression principle (2026-10-08).
  it('stays within its size pin — 2 700 (and does not fit v13’s 2 500: stated, not sneaked)', () => {
    expect(textOf(TRAINING_COACH_V14).length).toBeLessThanOrEqual(2700);
    expect(textOf(TRAINING_COACH_V14).length).toBeGreaterThan(2500);
  });

  it('deriveV14Template fails loudly when the v13 needle is missing (stale derivation)', () => {
    expect(() => deriveV14Template(COACH_TEMPLATE_V13.replace(V13_RULE, 'something else entirely'))).toThrow(/needle/);
  });
});

describe('PROMPT_VERSION_TRAINING — the version switch (default v13, candidate v14)', () => {
  it.each([
    [undefined, 'v13'],
    ['v13', 'v13'],
    ['v14', 'v14'],
  ])('env %p selects %p (read once at composition; the old version stays for comparison)', (env, expected) => {
    const previous = process.env.PROMPT_VERSION_TRAINING;
    if (env === undefined) {
      delete process.env.PROMPT_VERSION_TRAINING;
    } else {
      process.env.PROMPT_VERSION_TRAINING = env;
    }
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { TRAINING_PROMPT } = require('../index') as { TRAINING_PROMPT: { current: { version: string } } };
        expect(TRAINING_PROMPT.current.version).toBe(expected);
      });
    } finally {
      if (previous === undefined) {
        delete process.env.PROMPT_VERSION_TRAINING;
      } else {
        process.env.PROMPT_VERSION_TRAINING = previous;
      }
    }
  });
});
