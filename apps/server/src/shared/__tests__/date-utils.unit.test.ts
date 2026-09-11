import { calendarDaysAgo } from '../date-utils';

describe('calendarDaysAgo', () => {
  it('returns 0 for the same calendar day', () => {
    const now = new Date('2025-06-15T10:00:00');
    const date = new Date('2025-06-15T23:59:59');
    expect(calendarDaysAgo(date, now)).toBe(0);
  });

  it('returns 1 when date is yesterday even if only minutes apart', () => {
    const now = new Date('2025-06-15T00:05:00');
    const date = new Date('2025-06-14T23:50:00');
    expect(calendarDaysAgo(date, now)).toBe(1);
  });

  it('returns 1 for full-day difference', () => {
    const now = new Date('2025-06-15T18:00:00');
    const date = new Date('2025-06-14T09:00:00');
    expect(calendarDaysAgo(date, now)).toBe(1);
  });

  it('handles cross-month boundary', () => {
    const now = new Date('2025-07-01T08:00:00');
    const date = new Date('2025-06-30T22:00:00');
    expect(calendarDaysAgo(date, now)).toBe(1);
  });

  it('handles cross-year boundary', () => {
    const now = new Date('2026-01-01T01:00:00');
    const date = new Date('2025-12-31T23:00:00');
    expect(calendarDaysAgo(date, now)).toBe(1);
  });

  it('returns correct count for multi-day gap', () => {
    const now = new Date('2025-06-20T12:00:00');
    const date = new Date('2025-06-15T12:00:00');
    expect(calendarDaysAgo(date, now)).toBe(5);
  });

  it('returns negative when date is in the future', () => {
    const now = new Date('2025-06-15T10:00:00');
    const date = new Date('2025-06-17T10:00:00');
    expect(calendarDaysAgo(date, now)).toBe(-2);
  });

  it('handles leap year Feb 28 → Mar 1', () => {
    const now = new Date('2024-03-01T06:00:00');
    const date = new Date('2024-02-28T22:00:00');
    expect(calendarDaysAgo(date, now)).toBe(2);
  });
});
