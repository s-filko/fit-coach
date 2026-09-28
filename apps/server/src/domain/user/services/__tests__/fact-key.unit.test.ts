import { computeFactKey } from '@domain/user/services/fact-key';

describe('computeFactKey (D-C)', () => {
  it('lowercases, trims, collapses whitespace and strips terminal punctuation', () => {
    expect(computeFactKey('  User has a   LOWER BACK injury  ')).toBe('user has a lower back injury');
    expect(computeFactKey('No deadlifts.')).toBe('no deadlifts');
    expect(computeFactKey('Prefers mornings!?;:')).toBe('prefers mornings');
  });

  it('leaves interior punctuation and a key that needs no normalisation untouched', () => {
    expect(computeFactKey('user has a lower back injury — no direct loading')).toBe(
      'user has a lower back injury — no direct loading',
    );
    expect(computeFactKey('trains at home')).toBe('trains at home');
  });
});
