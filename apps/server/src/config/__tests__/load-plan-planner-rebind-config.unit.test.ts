/**
 * Load-plan plan A5 (Task 5b): LOAD_PLAN_PLANNER_REBIND is a boolean env flag, default false —
 * next to LOAD_PLAN_SUGGESTION and LOAD_PLAN_BREAKS, independent of both.
 */
import { EnvSchema } from '..';
import { BASE_ENV } from './base-env.fixture';

describe('AC-LP-7 · LOAD_PLAN_PLANNER_REBIND (A5)', () => {
  it('defaults to false, independent of the other load-plan flags', () => {
    const parsed = EnvSchema.parse(BASE_ENV) as Record<string, unknown>;
    expect(parsed['LOAD_PLAN_PLANNER_REBIND']).toBe(false);
    const on = EnvSchema.parse({ ...BASE_ENV, LOAD_PLAN_SUGGESTION: 'true', LOAD_PLAN_BREAKS: 'true' }) as Record<
      string,
      unknown
    >;
    expect(on['LOAD_PLAN_PLANNER_REBIND']).toBe(false);
  });

  it("parses 'true'/'false' strings", () => {
    const on = EnvSchema.parse({ ...BASE_ENV, LOAD_PLAN_PLANNER_REBIND: 'true' }) as Record<string, unknown>;
    const off = EnvSchema.parse({ ...BASE_ENV, LOAD_PLAN_PLANNER_REBIND: 'false' }) as Record<string, unknown>;
    expect(on['LOAD_PLAN_PLANNER_REBIND']).toBe(true);
    expect(off['LOAD_PLAN_PLANNER_REBIND']).toBe(false);
  });
});
