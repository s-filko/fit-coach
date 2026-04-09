const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Calendar-day difference between `now` and `date`.
 * When `tz` is provided, "today" is computed in the user's timezone.
 * Strips time components so "23:50 yesterday" → 1, not 0.
 */
export function calendarDaysAgo(date: Date, now: Date = new Date(), tz?: string | null): number {
  if (tz) {
    const nowDate = dateInTz(now, tz);
    const thenDate = dateInTz(date, tz);
    return Math.round((nowDate - thenDate) / MS_PER_DAY);
  }
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((nowDay - dateDay) / MS_PER_DAY);
}

/** Midnight epoch-ms for `date` in the given IANA timezone. */
function dateInTz(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return new Date(parts).getTime();
}

/**
 * Format a Date into date-only and time strings in the user's timezone.
 * Falls back to UTC when `tz` is absent or invalid.
 */
export function formatInUserTz(date: Date, tz?: string | null): { dateOnly: string; time: string; label: string } {
  const timeZone = tz && isValidTimezone(tz) ? tz : 'UTC';
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return {
    dateOnly: dateFmt.format(date),
    time: timeFmt.format(date),
    label: timeZone,
  };
}

function timeOfDayLabel(hour: number): string {
  if (hour < 6) {
    return 'night';
  }
  if (hour < 12) {
    return 'morning';
  }
  if (hour < 17) {
    return 'afternoon';
  }
  return 'evening';
}

function hourInTz(date: Date, tz?: string | null): number {
  const timeZone = tz && isValidTimezone(tz) ? tz : 'UTC';
  const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hour12: false }).format(date);
  return parseInt(h, 10);
}

function weekdayInTz(date: Date, tz?: string | null): string {
  const timeZone = tz && isValidTimezone(tz) ? tz : 'UTC';
  const d = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return d;
}

/**
 * Human-readable time-ago label for LLM prompts.
 *
 * ≤ 3 days: "today (Wed) morning", "yesterday (Tue) evening", "2d ago (Mon) afternoon"
 * 4–7 days: "5d ago (Fri)" — weekday but no time-of-day
 * > 7 days: "12d ago" — just the number
 */
export function humanTimeAgo(date: Date, now: Date = new Date(), tz?: string | null): string {
  const daysAgo = calendarDaysAgo(date, now, tz);
  const weekday = weekdayInTz(date, tz);

  if (daysAgo <= 3) {
    const tod = timeOfDayLabel(hourInTz(date, tz));
    if (daysAgo === 0) {
      return `today (${weekday}) ${tod}`;
    }
    if (daysAgo === 1) {
      return `yesterday (${weekday}) ${tod}`;
    }
    return `${daysAgo}d ago (${weekday}) ${tod}`;
  }

  if (daysAgo <= 7) {
    return `${daysAgo}d ago (${weekday})`;
  }

  return `${daysAgo}d ago`;
}

/** Validate an IANA timezone string. */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
