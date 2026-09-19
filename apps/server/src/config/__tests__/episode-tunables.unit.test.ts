import { EnvSchema } from '../index';
import { BASE_ENV } from './base-env.fixture';

const BASE = BASE_ENV;

describe('episode-memory tunables (D-L — the second documented defaults exception)', () => {
  it('defaults EPISODE_GAP_HOURS=3, EPISODE_MIN_TURNS=2, EPISODE_MIN_TOKENS=300', () => {
    const env = EnvSchema.parse(BASE);
    expect(env.EPISODE_GAP_HOURS).toBe(3);
    expect(env.EPISODE_MIN_TURNS).toBe(2);
    expect(env.EPISODE_MIN_TOKENS).toBe(300);
  });

  it('coerces string overrides to numbers', () => {
    const env = EnvSchema.parse({ ...BASE, EPISODE_GAP_HOURS: '5', EPISODE_MIN_TURNS: '4', EPISODE_MIN_TOKENS: '800' });
    expect(env.EPISODE_GAP_HOURS).toBe(5);
    expect(env.EPISODE_MIN_TURNS).toBe(4);
    expect(env.EPISODE_MIN_TOKENS).toBe(800);
  });

  it('rejects a non-numeric override (fail fast, not NaN at runtime)', () => {
    expect(() => EnvSchema.parse({ ...BASE, EPISODE_GAP_HOURS: 'soon' })).toThrow();
  });
});
