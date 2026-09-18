import { parsePrefixedEnv } from '../prefixed-env';

describe('parsePrefixedEnv (shared prefixed-env-var parser used by LLM_PROFILE_* and LLM_BUDGET_*, R2)', () => {
  it('returns an empty map when the pattern matches nothing', () => {
    const result = parsePrefixedEnv({ env: { LLM_MODEL: 'x', OTHER: 'y' }, pattern: /^FOO_([A-Z0-9_]+)_(BAR)$/ });
    expect(result).toEqual({});
  });

  it('ignores null/empty values even when the key matches', () => {
    const result = parsePrefixedEnv({
      env: { FOO_A_BAR: '   ' },
      pattern: /^FOO_([A-Z0-9_]+)_(BAR)$/,
    });
    expect(result).toEqual({});
  });

  it('lower-cases the captured group-1 name and groups entries under it', () => {
    const result = parsePrefixedEnv({
      env: { FOO_ALPHA_BAR: '1', FOO_ALPHA_BAZ: '2', FOO_BETA_BAR: '3' },
      pattern: /^FOO_([A-Z0-9_]+)_(BAR|BAZ)$/,
      assign: (acc, { key, raw, field }) => {
        acc[field === 'BAR' ? 'bar' : 'baz'] = `${key}=${raw}`;
      },
    });
    expect(result).toEqual({
      alpha: { bar: 'FOO_ALPHA_BAR=1', baz: 'FOO_ALPHA_BAZ=2' },
      beta: { bar: 'FOO_BETA_BAR=3' },
    });
  });

  it('lets assign throw to reject an invalid value, propagating the error', () => {
    expect(() =>
      parsePrefixedEnv({
        env: { FOO_A_BAR: 'not-a-number' },
        pattern: /^FOO_([A-Z0-9_]+)_(BAR)$/,
        assign: (_acc, { key, raw }) => {
          if (Number.isNaN(Number(raw))) {
            throw new Error(`${key} must be a number`);
          }
        },
      }),
    ).toThrow(/FOO_A_BAR must be a number/);
  });

  it('splits the captured name from a trailing part correctly even when the name itself has underscores', () => {
    const result = parsePrefixedEnv({
      env: { FOO_SESSION_PLANNING_BAR: '1' },
      pattern: /^FOO_([A-Z0-9]+(?:_[A-Z0-9]+)*)_(BAR)$/,
      assign: (acc, { raw }) => {
        acc.bar = raw;
      },
    });
    expect(result).toEqual({ session_planning: { bar: '1' } });
  });
});
