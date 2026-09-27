import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

const BASE = BASE_ENV;

describe('STT config (D2 — optional key, tunables-not-secrets defaults)', () => {
  it('defaults STT_MODEL=gemini-3.8-flash, STT_API_URL, STT_TIMEOUT_MS=30000, and parses without STT_API_KEY (server boots)', () => {
    const env = EnvSchema.parse(BASE);
    expect(env.STT_API_KEY).toBeUndefined();
    expect(env.STT_MODEL).toBe('gemini-3.8-flash');
    expect(env.STT_API_URL).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(env.STT_TIMEOUT_MS).toBe(30000);
  });

  it('accepts overrides and coerces the timeout to a number', () => {
    const env = EnvSchema.parse({
      ...BASE,
      STT_API_KEY: 'k',
      STT_MODEL: 'other-model',
      STT_API_URL: 'https://stt.example.com',
      STT_TIMEOUT_MS: '5000',
    });
    expect(env.STT_API_KEY).toBe('k');
    expect(env.STT_MODEL).toBe('other-model');
    expect(env.STT_API_URL).toBe('https://stt.example.com');
    expect(env.STT_TIMEOUT_MS).toBe(5000);
  });

  it('rejects a non-numeric timeout (fail fast, not NaN at runtime)', () => {
    expect(() => EnvSchema.parse({ ...BASE, STT_TIMEOUT_MS: 'soon' })).toThrow();
  });

  it('rejects a non-URL STT_API_URL', () => {
    expect(() => EnvSchema.parse({ ...BASE, STT_API_URL: 'not-a-url' })).toThrow();
  });
});
