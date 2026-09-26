import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

const BASE = BASE_ENV;

describe('LLM_CACHE_TTL_SECONDS / LLM_CACHE_MIN_PREFIX_TOKENS (D6 — provider cache limits are config, never guessed)', () => {
  it('unset = undefined, not defaulted (unlike the other LLM_* tunables — Z.AI documents neither limit)', () => {
    const parsed = EnvSchema.parse(BASE);
    expect(parsed.LLM_CACHE_TTL_SECONDS).toBeUndefined();
    expect(parsed.LLM_CACHE_MIN_PREFIX_TOKENS).toBeUndefined();
  });

  it('coerces a configured value', () => {
    const parsed = EnvSchema.parse({ ...BASE, LLM_CACHE_TTL_SECONDS: '300', LLM_CACHE_MIN_PREFIX_TOKENS: '1024' });
    expect(parsed.LLM_CACHE_TTL_SECONDS).toBe(300);
    expect(parsed.LLM_CACHE_MIN_PREFIX_TOKENS).toBe(1024);
  });

  it('rejects a non-positive or non-integer value (fail fast, not silently ignored)', () => {
    expect(() => EnvSchema.parse({ ...BASE, LLM_CACHE_TTL_SECONDS: '0' })).toThrow(/LLM_CACHE_TTL_SECONDS/);
    expect(() => EnvSchema.parse({ ...BASE, LLM_CACHE_MIN_PREFIX_TOKENS: '1.5' })).toThrow(
      /LLM_CACHE_MIN_PREFIX_TOKENS/,
    );
  });
});
