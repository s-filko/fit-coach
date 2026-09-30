import { defaultProgression, goalFromProfile } from '../scheme-default';

/** D8: until the user chooses, novice + strength → linear, otherwise double; printed "default, unconfirmed". */
describe('goalFromProfile', () => {
  it.each([
    ['get stronger', 'strength'],
    ['increase strength', 'strength'],
    ['build muscle', 'hypertrophy'],
    ['muscle gain', 'hypertrophy'],
    ['lose weight', 'general'],
    [null, 'general'],
    ['', 'general'],
  ])('%s → %s', (text, goal) => {
    expect(goalFromProfile(text)).toBe(goal);
  });
});

describe('defaultProgression', () => {
  it('beginner + strength → linear', () => {
    const d = defaultProgression({ fitnessLevel: 'beginner', fitnessGoal: 'get stronger' });
    expect(d.scheme.id).toBe('linear_progression');
    expect(d.goal).toBe('strength');
    expect(d.source).toBe('default');
  });

  it.each([
    [{ fitnessLevel: 'intermediate', fitnessGoal: 'get stronger' }],
    [{ fitnessLevel: 'beginner', fitnessGoal: 'build muscle' }],
    [{ fitnessLevel: null, fitnessGoal: null }],
    [null],
  ])('%j → double', profile => {
    expect(defaultProgression(profile).scheme.id).toBe('double_progression');
  });
});
