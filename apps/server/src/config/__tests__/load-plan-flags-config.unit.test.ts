/** load-plan plan A5: LOAD_PLAN_SUGGESTION is a boolean flag, default off (Task 3 introduces it). */
import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

describe('load-plan flags (A5)', () => {
  it('LOAD_PLAN_SUGGESTION defaults to false, accepts true/false, rejects anything else', () => {
    const off = EnvSchema.parse(BASE_ENV) as Record<string, unknown>;
    expect(off['LOAD_PLAN_SUGGESTION']).toBe(false);
    const on = EnvSchema.parse({ ...BASE_ENV, LOAD_PLAN_SUGGESTION: 'true' }) as Record<string, unknown>;
    expect(on['LOAD_PLAN_SUGGESTION']).toBe(true);
    expect(() => EnvSchema.parse({ ...BASE_ENV, LOAD_PLAN_SUGGESTION: 'yes' })).toThrow(/LOAD_PLAN_SUGGESTION/);
  });
});
