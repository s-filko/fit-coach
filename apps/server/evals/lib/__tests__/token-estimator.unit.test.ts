import { estimateTokens } from '../token-estimator';

describe('estimateTokens', () => {
  it('is chars/4 with a 1.15 safety factor, rounded up', () => {
    // 40 chars → 10 * 1.15 = 11.5 → 12
    expect(estimateTokens('a'.repeat(40))).toBe(12);
  });

  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates Cyrillic text at least as high as Latin of the same length', () => {
    const latin = estimateTokens('a'.repeat(100));
    const cyrillic = estimateTokens('я'.repeat(100));
    expect(cyrillic).toBeGreaterThanOrEqual(latin);
  });
});
