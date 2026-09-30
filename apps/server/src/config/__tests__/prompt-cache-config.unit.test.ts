/**
 * Prompt-caching plan (BUG-051) T4 — D6 config: LLM_PROMPT_CACHE / LLM_PROMPT_CACHE_TTL (AC-PC-3).
 */
import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

describe('prompt-cache config (D6)', () => {
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
});
