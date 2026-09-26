import { commonPrefixLength } from '@shared/common-prefix';

describe('commonPrefixLength', () => {
  it('returns the full length when both strings are identical', () => {
    expect(commonPrefixLength('squat', 'squat')).toBe(5);
  });

  it('returns 0 when the strings share no prefix', () => {
    expect(commonPrefixLength('squat', 'lunge')).toBe(0);
  });

  it('stops at the first differing character', () => {
    expect(commonPrefixLength('squats', 'squatting')).toBe(5);
  });

  it('is bounded by the shorter string', () => {
    expect(commonPrefixLength('sq', 'squat')).toBe(2);
  });

  it('handles empty strings', () => {
    expect(commonPrefixLength('', 'squat')).toBe(0);
    expect(commonPrefixLength('', '')).toBe(0);
  });
});
