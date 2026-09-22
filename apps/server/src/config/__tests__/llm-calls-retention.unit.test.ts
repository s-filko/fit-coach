import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

const BASE = BASE_ENV;

describe('LLM_CALLS_RETENTION_DAYS (BR-LLM-011 — the prune window is config, not a hardcoded number)', () => {
  it('defaults to 30 days', () => {
    expect(EnvSchema.parse(BASE).LLM_CALLS_RETENTION_DAYS).toBe(30);
  });

  it('coerces a string override', () => {
    expect(EnvSchema.parse({ ...BASE, LLM_CALLS_RETENTION_DAYS: '7' }).LLM_CALLS_RETENTION_DAYS).toBe(7);
  });

  it('rejects a non-positive window (fail fast)', () => {
    expect(() => EnvSchema.parse({ ...BASE, LLM_CALLS_RETENTION_DAYS: '0' })).toThrow(/LLM_CALLS_RETENTION_DAYS/);
    expect(() => EnvSchema.parse({ ...BASE, LLM_CALLS_RETENTION_DAYS: 'soon' })).toThrow(/LLM_CALLS_RETENTION_DAYS/);
  });
});
