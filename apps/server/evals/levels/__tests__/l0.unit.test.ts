import { FORBIDDEN_STRINGS, checkRenderedPrompt } from '../l0';

describe('L0 static checks', () => {
  it('flags a prompt containing "undefined"', () => {
    const results = checkRenderedPrompt('chat', 'empty-profile', 'Your age is undefined years.');
    const forbidden = results.find(r => r.check === 'no-forbidden-strings');
    expect(forbidden?.passed).toBe(false);
    expect(forbidden?.detail).toContain('undefined');
  });

  it('passes a clean prompt', () => {
    const results = checkRenderedPrompt('chat', 'empty-profile', 'You are a fitness coach. Be concise.');
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('flags an empty prompt as non-renderable', () => {
    const results = checkRenderedPrompt('chat', 'empty-profile', '   ');
    const nonEmpty = results.find(r => r.check === 'renders-non-empty');
    expect(nonEmpty?.passed).toBe(false);
  });

  it('flags a prompt over the token budget', () => {
    const results = checkRenderedPrompt('chat', 'empty-profile', 'x'.repeat(200_000));
    const budget = results.find(r => r.check === 'within-token-budget');
    expect(budget?.passed).toBe(false);
  });

  it('does not flag the forbidden words used as ordinary prose', () => {
    // The real training prompt contains "may execute in undefined sequence".
    // L0 looks for rendering holes, not for English words.
    const results = checkRenderedPrompt(
      'training',
      'complete-profile',
      'Sets without order may execute in undefined sequence.',
    );
    const forbidden = results.find(r => r.check === 'no-forbidden-strings');
    expect(forbidden?.passed).toBe(true);
  });

  it('flags a forbidden token in a value position', () => {
    const results = checkRenderedPrompt('chat', 'complete-profile', 'Weight: null kg');
    const forbidden = results.find(r => r.check === 'no-forbidden-strings');
    expect(forbidden?.passed).toBe(false);
  });

  it('lists every forbidden string the spec names', () => {
    expect(FORBIDDEN_STRINGS).toEqual(expect.arrayContaining(['undefined', 'null', '[object Object]', 'NaN']));
  });
});
