const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Calendar-day difference between `now` and `date` (timezone-agnostic).
 * Strips time components so "23:50 yesterday" → 1, not 0.
 */
export function calendarDaysAgo(date: Date, now: Date = new Date()): number {
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((nowDay - dateDay) / MS_PER_DAY);
}
