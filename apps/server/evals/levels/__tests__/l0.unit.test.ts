import { FORBIDDEN_STRINGS, FORBIDDEN_STRING_ALLOWLIST, checkRenderedPrompt } from '../l0';

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

  it('lists every forbidden string the spec names', () => {
    expect(FORBIDDEN_STRINGS).toEqual(expect.arrayContaining(['undefined', 'null', '[object Object]', 'NaN']));
  });

  it('passes the allowlisted prose phrase from the training prompt', () => {
    const [allowed] = FORBIDDEN_STRING_ALLOWLIST;
    const results = checkRenderedPrompt('training', 'complete-profile', `RULE 7. ${allowed}.`);
    const forbidden = results.find(r => r.check === 'no-forbidden-strings');
    expect(forbidden?.passed).toBe(true);
  });

  it('still flags prose that is not in the allowlist verbatim', () => {
    // A near-miss of the allowlisted phrase must NOT inherit its exemption:
    // the allowlist is literal, so anything else containing a forbidden token fails.
    const results = checkRenderedPrompt('training', 'complete-profile', 'Sets may run in undefined order.');
    const forbidden = results.find(r => r.check === 'no-forbidden-strings');
    expect(forbidden?.passed).toBe(false);
    expect(forbidden?.detail).toContain('undefined');
  });
});
