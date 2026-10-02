/**
 * `TRAINING_COACH` v13 (coach-simplification I1, AC-CS1-1, P4): the whole training prompt stays within its size
 * limit, names the client's language, says where the facts arrive, and carries none of the old rulebook.
 */
import type { DirectiveContext } from '@infra/ai/prompts/types';

import { TRAINING_COACH, type TrainingCoachContext } from '../coach';

const MAX_COACH_CHARS = 2500;

function ctx(languageCode: string | null): TrainingCoachContext {
  return {
    user: { id: 'u1', firstName: 'Alex', languageCode },
    lastMessageTime: null,
    profileFacts: [],
  } as unknown as DirectiveContext & TrainingCoachContext;
}

const sectionOf = (languageCode: string | null, id: string): string =>
  TRAINING_COACH.render(ctx(languageCode)).find(s => s.id === id)?.text ?? '';

describe('TRAINING_COACH', () => {
  it('is phase.training v13 with no directives and the sections coach + profile', () => {
    expect(TRAINING_COACH.id).toBe('phase.training');
    expect(TRAINING_COACH.version).toBe('v13');
    expect(TRAINING_COACH.directives).toEqual([]);
    expect(TRAINING_COACH.render(ctx('ru')).map(s => [s.id, s.required])).toEqual([
      ['coach', true],
      ['profile', true],
    ]);
  });

  it.each(['ru', 'uk', null])('the coach section is at most 2 500 characters (languageCode %s)', code => {
    expect(sectionOf(code, 'coach').length).toBeLessThanOrEqual(MAX_COACH_CHARS);
  });

  it('names the language in English; falls back for an absent code', () => {
    expect(sectionOf('ru', 'coach')).toContain('You answer in Russian,');
    expect(sectionOf('uk', 'coach')).toContain('You answer in Ukrainian,');
    expect(sectionOf(null, 'coach')).toContain("You answer in the client's language,");
    expect(sectionOf('ru', 'coach')).not.toContain('{language}');
  });

  it('says where the facts arrive and carries none of the old rulebook', () => {
    const text = sectionOf('ru', 'coach');
    expect(text).toContain('<context>');
    expect(text).not.toMatch(/RULE|LOAD PLAN|EXERCISE HISTORY|WORKOUT OVERVIEW|SESSION GUIDE/);
  });

  it('renders the profile section from the user and facts', () => {
    expect(sectionOf('ru', 'profile')).toMatch(/^# Profile\n- Alex/);
  });
});
