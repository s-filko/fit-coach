import { EnvSchema } from '../index';

const BASE = {
  NODE_ENV: 'development',
  PORT: '3000',
  HOST: '0.0.0.0',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'db',
  BOT_API_KEY: 'k',
  TELEGRAM_TOKEN: 't',
  LLM_API_KEY: 'k',
  LLM_MODEL: 'm',
  LLM_TEMPERATURE: '0.7',
};

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
