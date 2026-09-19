import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

const BASE = BASE_ENV;

describe('LLM_STRUCTURED_OUTPUT_MODE (json_object route for providers without json_schema)', () => {
  it("defaults to 'json_schema' — today's request, byte-identical", () => {
    const env = EnvSchema.parse(BASE);
    expect(env.LLM_STRUCTURED_OUTPUT_MODE).toBe('json_schema');
  });

  it("accepts 'json_object'", () => {
    const env = EnvSchema.parse({ ...BASE, LLM_STRUCTURED_OUTPUT_MODE: 'json_object' });
    expect(env.LLM_STRUCTURED_OUTPUT_MODE).toBe('json_object');
  });

  it('rejects an unknown mode with a clear message (fail fast at startup)', () => {
    const result = EnvSchema.safeParse({ ...BASE, LLM_STRUCTURED_OUTPUT_MODE: 'yaml' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      expect(issues).toContain('LLM_STRUCTURED_OUTPUT_MODE');
      expect(issues).toContain('json_schema');
      expect(issues).toContain('json_object');
    }
  });
});
