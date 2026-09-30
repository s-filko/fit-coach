/**
 * Prompt-caching plan (BUG-051) T2 — D6 / D5 / D8 config surface (AC-PC-3, AC-PC-6, AC-PC-9): the flags the
 * other repro tests set. Names, defaults and types are the interface T4/T5/T5b implement to.
 */
import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

describe('prompt-cache config (D5, D6, D8)', () => {
  it('AC-PC-3: LLM_PROMPT_CACHE defaults to off, LLM_PROMPT_CACHE_TTL to 5m', () => {
    const parsed = EnvSchema.parse(BASE_ENV) as Record<string, unknown>;
    expect(parsed['LLM_PROMPT_CACHE']).toBe('off');
    expect(parsed['LLM_PROMPT_CACHE_TTL']).toBe('5m');
  });

  it('AC-PC-3: accepts anthropic / 1h, rejects anything else (fail fast)', () => {
    const parsed = EnvSchema.parse({
      ...BASE_ENV,
      LLM_PROMPT_CACHE: 'anthropic',
      LLM_PROMPT_CACHE_TTL: '1h',
    }) as Record<string, unknown>;
    expect(parsed['LLM_PROMPT_CACHE']).toBe('anthropic');
    expect(parsed['LLM_PROMPT_CACHE_TTL']).toBe('1h');
    expect(() => EnvSchema.parse({ ...BASE_ENV, LLM_PROMPT_CACHE: 'openai' })).toThrow(/LLM_PROMPT_CACHE/);
    expect(() => EnvSchema.parse({ ...BASE_ENV, LLM_PROMPT_CACHE_TTL: '10m' })).toThrow(/LLM_PROMPT_CACHE_TTL/);
  });

  it('AC-PC-6: LLM_CONTEXT_HARD_CAP_TOKENS defaults to 60000 (estimated tokens), rejects non-positive', () => {
    const parsed = EnvSchema.parse(BASE_ENV) as Record<string, unknown>;
    expect(parsed['LLM_CONTEXT_HARD_CAP_TOKENS']).toBe(60_000);
    expect(() => EnvSchema.parse({ ...BASE_ENV, LLM_CONTEXT_HARD_CAP_TOKENS: '0' })).toThrow(
      /LLM_CONTEXT_HARD_CAP_TOKENS/,
    );
  });

  it('AC-PC-9: LLM_INPUT_PRICE_PER_MTOK (USD per million uncached input tokens) is optional, coerced', () => {
    const unset = EnvSchema.parse(BASE_ENV) as Record<string, unknown>;
    expect(unset['LLM_INPUT_PRICE_PER_MTOK']).toBeUndefined();
    const set = EnvSchema.parse({ ...BASE_ENV, LLM_INPUT_PRICE_PER_MTOK: '3' }) as Record<string, unknown>;
    expect(set['LLM_INPUT_PRICE_PER_MTOK']).toBe(3);
  });
});
