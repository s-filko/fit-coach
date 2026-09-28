import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

const BASE = BASE_ENV;

describe('LLM inference tunables (BUG-019 / AC-RL-1 — cap and reasoning depth are config)', () => {
  it('defaults LLM_MAX_TOKENS=16384 and LLM_REASONING_EFFORT=low (BUG-019 fixed on deploy)', () => {
    const env = EnvSchema.parse(BASE);
    expect(env.LLM_MAX_TOKENS).toBe(16384);
    expect(env.LLM_REASONING_EFFORT).toBe('low');
  });

  it('coerces a string max-tokens override and accepts every effort value', () => {
    expect(EnvSchema.parse({ ...BASE, LLM_MAX_TOKENS: '8192' }).LLM_MAX_TOKENS).toBe(8192);
    for (const effort of ['high', 'max', 'off'] as const) {
      expect(EnvSchema.parse({ ...BASE, LLM_REASONING_EFFORT: effort }).LLM_REASONING_EFFORT).toBe(effort);
    }
  });

  it('rejects a non-numeric/non-positive max tokens and an unknown effort (fail fast)', () => {
    expect(() => EnvSchema.parse({ ...BASE, LLM_MAX_TOKENS: 'soon' })).toThrow(/LLM_MAX_TOKENS/);
    expect(() => EnvSchema.parse({ ...BASE, LLM_MAX_TOKENS: '0' })).toThrow(/LLM_MAX_TOKENS/);
    expect(() => EnvSchema.parse({ ...BASE, LLM_REASONING_EFFORT: 'medium' })).toThrow(/LLM_REASONING_EFFORT/);
  });
});
