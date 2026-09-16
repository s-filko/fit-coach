import { checkRenderedPrompt, checkSections, FORBIDDEN_STRING_ALLOWLIST, FORBIDDEN_STRINGS, runL0 } from '../l0';

describe('L0 static checks (AC-1303 L0 half, PROMPT_EVAL_FRAMEWORK §4.1)', () => {
  it('flags a prompt containing "undefined"', () => {
    const results = checkRenderedPrompt('phase.chat', 'empty-profile', 'Your age is undefined years.');
    const forbidden = results.find(r => r.check === 'no-forbidden-strings');
    expect(forbidden?.passed).toBe(false);
    expect(forbidden?.detail).toContain('undefined');
  });

  it('passes a clean prompt', () => {
    const results = checkRenderedPrompt('phase.chat', 'empty-profile', 'You are a fitness coach. Be concise.');
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('flags an empty prompt as non-renderable', () => {
    const results = checkRenderedPrompt('phase.chat', 'empty-profile', '   ');
    const nonEmpty = results.find(r => r.check === 'renders-non-empty');
    expect(nonEmpty?.passed).toBe(false);
  });

  it('flags a prompt over the token budget', () => {
    const results = checkRenderedPrompt('phase.chat', 'empty-profile', 'x'.repeat(200_000));
    const budget = results.find(r => r.check === 'within-token-budget');
    expect(budget?.passed).toBe(false);
  });

  it('lists every forbidden string §4.1 names', () => {
    expect(FORBIDDEN_STRINGS).toEqual(expect.arrayContaining(['undefined', 'null', '[object Object]', 'NaN']));
  });

  it('passes the allowlisted prose phrase from the training prompt', () => {
    const [allowed] = FORBIDDEN_STRING_ALLOWLIST;
    const results = checkRenderedPrompt('phase.training', 'complete-profile', `RULE 7. ${allowed}.`);
    const forbidden = results.find(r => r.check === 'no-forbidden-strings');
    expect(forbidden?.passed).toBe(true);
  });

  it('still flags prose that is not in the allowlist verbatim', () => {
    // A near-miss of the allowlisted phrase must NOT inherit its exemption:
    // the allowlist is literal, so anything else containing a forbidden token fails.
    const results = checkRenderedPrompt('phase.training', 'complete-profile', 'Sets may run in undefined order.');
    const forbidden = results.find(r => r.check === 'no-forbidden-strings');
    expect(forbidden?.passed).toBe(false);
    expect(forbidden?.detail).toContain('undefined');
  });
});

describe('L0 registry iteration (AC-1303, refactor-p2-prompt-modules Task 6)', () => {
  it('fails when a required section is missing (§4.1 section presence)', () => {
    const results = checkSections('phase.chat', 'empty-profile', ['context', 'rules'], ['context', 'rules', 'tools']);
    const check = results.find(r => r.check === 'required-sections-present');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('tools');
  });

  it('passes when every required section is present', () => {
    const results = checkSections('phase.chat', 'empty-profile', ['context', 'rules', 'tools'], ['context', 'rules', 'tools']);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('renders every registry module for every fixture', async () => {
    const results = await runL0('all');
    const cases = new Set(results.map(r => r.case));
    expect(cases.has('phase.chat/empty-profile')).toBe(true);
    expect(cases.has('summarizer/empty-profile')).toBe(true);
    expect(cases.has('block.tool_results/empty-profile')).toBe(true);
    expect(results.every(r => r.passed)).toBe(true);
  });
});
