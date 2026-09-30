/**
 * Load-plan plan A5: LOAD_PLAN_SUGGESTION is a boolean env flag, default false.
 */
import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

describe('LOAD_PLAN_SUGGESTION (A5)', () => {
  it('defaults to false', () => {
    const parsed = EnvSchema.parse(BASE_ENV) as Record<string, unknown>;
    expect(parsed['LOAD_PLAN_SUGGESTION']).toBe(false);
  });

  it('parses "true" to true and "false" to false', () => {
    const on = EnvSchema.parse({ ...BASE_ENV, LOAD_PLAN_SUGGESTION: 'true' }) as Record<string, unknown>;
    const off = EnvSchema.parse({ ...BASE_ENV, LOAD_PLAN_SUGGESTION: 'false' }) as Record<string, unknown>;
    expect(on['LOAD_PLAN_SUGGESTION']).toBe(true);
    expect(off['LOAD_PLAN_SUGGESTION']).toBe(false);
  });

  it('rejects anything else (fail fast)', () => {
    expect(() => EnvSchema.parse({ ...BASE_ENV, LOAD_PLAN_SUGGESTION: 'yes' })).toThrow(/LOAD_PLAN_SUGGESTION/);
  });
});
