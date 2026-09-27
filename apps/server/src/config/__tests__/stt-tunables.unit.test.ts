import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

const BASE = BASE_ENV;

describe('STT config (AC-VT-2, AC-1419 — D2 optional key, tunables-not-secrets defaults)', () => {
  it('defaults STT_MODEL=gemini-3.8-flash, STT_API_URL, STT_TIMEOUT_MS=60000 (R3), STT_MAX_OUTPUT_TOKENS=4096 (R2), and parses without STT_API_KEY (server boots)', () => {
    const env = EnvSchema.parse(BASE);
    expect(env.STT_API_KEY).toBeUndefined();
    expect(env.STT_MODEL).toBe('gemini-3.8-flash');
    expect(env.STT_API_URL).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(env.STT_TIMEOUT_MS).toBe(60000);
    expect(env.STT_MAX_OUTPUT_TOKENS).toBe(4096);
  });

  it('accepts overrides and coerces the numbers', () => {
    const env = EnvSchema.parse({
      ...BASE,
      STT_API_KEY: 'k',
      STT_MODEL: 'other-model',
      STT_API_URL: 'https://stt.example.com',
      STT_TIMEOUT_MS: '5000',
      STT_MAX_OUTPUT_TOKENS: '8192',
    });
    expect(env.STT_API_KEY).toBe('k');
    expect(env.STT_MODEL).toBe('other-model');
    expect(env.STT_API_URL).toBe('https://stt.example.com');
    expect(env.STT_TIMEOUT_MS).toBe(5000);
    expect(env.STT_MAX_OUTPUT_TOKENS).toBe(8192);
  });

  it.each([
    ['STT_TIMEOUT_MS', 'soon'],
    ['STT_MAX_OUTPUT_TOKENS', 'many'],
  ])('rejects a non-numeric %s (fail fast, not NaN at runtime)', (key, bad) => {
    expect(() => EnvSchema.parse({ ...BASE, [key]: bad })).toThrow();
  });

  it('rejects a non-URL STT_API_URL', () => {
    expect(() => EnvSchema.parse({ ...BASE, STT_API_URL: 'not-a-url' })).toThrow();
  });
});
