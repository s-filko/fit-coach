/**
 * Prompt-caching plan (BUG-051) T4/T5 — D5/D6 config: LLM_PROMPT_CACHE / LLM_PROMPT_CACHE_TTL (AC-PC-3),
 * LLM_CONTEXT_HARD_CAP_TOKENS (AC-PC-6).
 */
import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

describe('prompt-cache config (D5, D6)', () => {
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
});

describe('LLM_MODEL_PRICES — the one price override, validated at config load (AC-PC-8)', () => {
  it('AC-PC-8: unset → an empty override; valid JSON → the parsed per-model prices', () => {
    expect((EnvSchema.parse(BASE_ENV) as Record<string, unknown>)['LLM_MODEL_PRICES']).toEqual({});
    const parsed = EnvSchema.parse({
      ...BASE_ENV,
      LLM_MODEL_PRICES: '{"vendor/m":{"input":2,"output":8}}',
    }) as Record<string, unknown>;
    expect(parsed['LLM_MODEL_PRICES']).toEqual({ 'vendor/m': { inputPerMTok: 2, outputPerMTok: 8 } });
  });

  it('AC-PC-8: malformed JSON or a wrong shape fails the config load (fail fast), naming the variable', () => {
    expect(() => EnvSchema.parse({ ...BASE_ENV, LLM_MODEL_PRICES: 'not json' })).toThrow(/LLM_MODEL_PRICES/);
    expect(() => EnvSchema.parse({ ...BASE_ENV, LLM_MODEL_PRICES: '{"m":{"input":-1,"output":1}}' })).toThrow(
      /LLM_MODEL_PRICES/,
    );
  });
});
