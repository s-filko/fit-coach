/**
 * Load-plan plan A5 (Task 4): LOAD_PLAN_BREAKS is a boolean env flag, default false — next to LOAD_PLAN_SUGGESTION.
 */
import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

describe('AC-LP-6 · LOAD_PLAN_BREAKS (A5)', () => {
  it('defaults to false, independent of LOAD_PLAN_SUGGESTION', () => {
    const parsed = EnvSchema.parse(BASE_ENV) as Record<string, unknown>;
    expect(parsed['LOAD_PLAN_BREAKS']).toBe(false);
    const on = EnvSchema.parse({ ...BASE_ENV, LOAD_PLAN_SUGGESTION: 'true' }) as Record<string, unknown>;
    expect(on['LOAD_PLAN_BREAKS']).toBe(false);
  });

  it('parses "true" to true and "false" to false', () => {
    const on = EnvSchema.parse({ ...BASE_ENV, LOAD_PLAN_BREAKS: 'true' }) as Record<string, unknown>;
    const off = EnvSchema.parse({ ...BASE_ENV, LOAD_PLAN_BREAKS: 'false' }) as Record<string, unknown>;
    expect(on['LOAD_PLAN_BREAKS']).toBe(true);
    expect(off['LOAD_PLAN_BREAKS']).toBe(false);
  });

  it('rejects anything else (fail fast)', () => {
    expect(() => EnvSchema.parse({ ...BASE_ENV, LOAD_PLAN_BREAKS: 'yes' })).toThrow(/LOAD_PLAN_BREAKS/);
  });
});
