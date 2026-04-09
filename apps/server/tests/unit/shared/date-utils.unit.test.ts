import { describe, expect, it } from '@jest/globals';

import { calendarDaysAgo, formatInUserTz, humanTimeAgo, isValidTimezone } from '@shared/date-utils';

describe('isValidTimezone', () => {
  it('accepts valid IANA timezones', () => {
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Asia/Tokyo')).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(isValidTimezone('NotATimezone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('Europe/')).toBe(false);
  });
});

describe('formatInUserTz', () => {
  const fixedDate = new Date('2026-04-09T14:30:00Z');

  it('formats in UTC by default', () => {
    const result = formatInUserTz(fixedDate);
    expect(result.dateOnly).toBe('2026-04-09');
    expect(result.time).toBe('14:30');
    expect(result.label).toBe('UTC');
  });

  it('formats in UTC when tz is null', () => {
    const result = formatInUserTz(fixedDate, null);
    expect(result.label).toBe('UTC');
    expect(result.dateOnly).toBe('2026-04-09');
  });

  it('formats in a specific timezone', () => {
    const result = formatInUserTz(fixedDate, 'Europe/Berlin');
    expect(result.dateOnly).toBe('2026-04-09');
    expect(result.time).toBe('16:30');
    expect(result.label).toBe('Europe/Berlin');
  });

  it('handles timezone crossing midnight', () => {
    const lateUtc = new Date('2026-04-09T23:30:00Z');
    const result = formatInUserTz(lateUtc, 'Asia/Tokyo');
    expect(result.dateOnly).toBe('2026-04-10');
    expect(result.time).toBe('08:30');
  });

  it('falls back to UTC for invalid timezone', () => {
    const result = formatInUserTz(fixedDate, 'Invalid/Zone');
    expect(result.label).toBe('UTC');
    expect(result.time).toBe('14:30');
  });
});

describe('calendarDaysAgo', () => {
  it('returns 0 for same day in UTC', () => {
    const now = new Date('2026-04-09T18:00:00Z');
    const date = new Date('2026-04-09T06:00:00Z');
    expect(calendarDaysAgo(date, now, 'UTC')).toBe(0);
  });

  it('returns 1 for yesterday in UTC', () => {
    const now = new Date('2026-04-09T01:00:00Z');
    const date = new Date('2026-04-08T23:00:00Z');
    expect(calendarDaysAgo(date, now, 'UTC')).toBe(1);
  });

  it('both dates same day in user tz', () => {
    // 2026-04-09 23:30 UTC = 2026-04-10 01:30 Berlin (CEST)
    // 2026-04-09 22:30 UTC = 2026-04-10 00:30 Berlin
    const now = new Date('2026-04-09T23:30:00Z');
    const date = new Date('2026-04-09T22:30:00Z');

    // In Berlin both are April 10 → 0
    expect(calendarDaysAgo(date, now, 'Europe/Berlin')).toBe(0);
  });

  it('different days in user tz', () => {
    // 2026-04-10 00:30 UTC = 2026-04-10 02:30 Berlin
    // 2026-04-09 21:30 UTC = 2026-04-09 23:30 Berlin
    const now = new Date('2026-04-10T00:30:00Z');
    const date = new Date('2026-04-09T21:30:00Z');

    // Berlin: Apr 10 vs Apr 9 → 1
    expect(calendarDaysAgo(date, now, 'Europe/Berlin')).toBe(1);
  });

  it('tz changes day boundary vs UTC', () => {
    // 2026-04-09 23:30 UTC → still Apr 9 in UTC
    // 2026-04-09 23:30 UTC → Apr 10 in Berlin (UTC+2 CEST)
    const now = new Date('2026-04-09T23:30:00Z');
    const date = new Date('2026-04-08T23:30:00Z');

    expect(calendarDaysAgo(date, now, 'UTC')).toBe(1);
    expect(calendarDaysAgo(date, now, 'Europe/Berlin')).toBe(1);
  });
});

describe('humanTimeAgo', () => {
  // Fixed "now": Thursday 2026-04-09 14:00 UTC
  const now = new Date('2026-04-09T14:00:00Z');

  describe('today (0 days ago)', () => {
    it('morning session', () => {
      const date = new Date('2026-04-09T08:00:00Z');
      expect(humanTimeAgo(date, now, 'UTC')).toBe('today (Thu) morning');
    });

    it('afternoon session', () => {
      const date = new Date('2026-04-09T13:00:00Z');
      expect(humanTimeAgo(date, now, 'UTC')).toBe('today (Thu) afternoon');
    });
  });

  describe('yesterday (1 day ago)', () => {
    it('evening session', () => {
      const date = new Date('2026-04-08T19:00:00Z');
      expect(humanTimeAgo(date, now, 'UTC')).toBe('yesterday (Wed) evening');
    });

    it('night session', () => {
      const date = new Date('2026-04-08T03:00:00Z');
      expect(humanTimeAgo(date, now, 'UTC')).toBe('yesterday (Wed) night');
    });
  });

  describe('2-3 days ago — with weekday + time of day', () => {
    it('2 days ago morning', () => {
      const date = new Date('2026-04-07T09:00:00Z');
      expect(humanTimeAgo(date, now, 'UTC')).toBe('2d ago (Tue) morning');
    });

    it('3 days ago evening', () => {
      const date = new Date('2026-04-06T20:00:00Z');
      expect(humanTimeAgo(date, now, 'UTC')).toBe('3d ago (Mon) evening');
    });
  });

  describe('4-7 days ago — weekday only, no time of day', () => {
    it('5 days ago', () => {
      const date = new Date('2026-04-04T10:00:00Z');
      expect(humanTimeAgo(date, now, 'UTC')).toBe('5d ago (Sat)');
    });

    it('7 days ago', () => {
      const date = new Date('2026-04-02T18:00:00Z');
      expect(humanTimeAgo(date, now, 'UTC')).toBe('7d ago (Thu)');
    });
  });

  describe('> 7 days ago — just number', () => {
    it('10 days ago', () => {
      const date = new Date('2026-03-30T12:00:00Z');
      expect(humanTimeAgo(date, now, 'UTC')).toBe('10d ago');
    });

    it('21 days ago', () => {
      const date = new Date('2026-03-19T15:00:00Z');
      expect(humanTimeAgo(date, now, 'UTC')).toBe('21d ago');
    });
  });

  describe('timezone-aware', () => {
    it('time-of-day shifts with timezone', () => {
      // 2026-04-09 04:00 UTC = 06:00 Berlin (CEST, UTC+2)
      // UTC: night (hour 4), Berlin: morning (hour 6)
      const date = new Date('2026-04-09T04:00:00Z');
      expect(humanTimeAgo(date, now, 'UTC')).toBe('today (Thu) night');
      expect(humanTimeAgo(date, now, 'Europe/Berlin')).toBe('today (Thu) morning');
    });

    it('day boundary shifts with timezone', () => {
      // 2026-04-08 23:00 UTC = 2026-04-09 01:00 Berlin
      // UTC: yesterday, Berlin: today
      const date = new Date('2026-04-08T23:00:00Z');
      const nowLate = new Date('2026-04-09T00:30:00Z');
      expect(humanTimeAgo(date, nowLate, 'UTC')).toBe('yesterday (Wed) evening');
      expect(humanTimeAgo(date, nowLate, 'Europe/Berlin')).toBe('today (Thu) night');
    });
  });

  it('falls back to UTC for null timezone', () => {
    const date = new Date('2026-04-09T08:00:00Z');
    expect(humanTimeAgo(date, now, null)).toBe('today (Thu) morning');
    expect(humanTimeAgo(date, now)).toBe('today (Thu) morning');
  });
});
