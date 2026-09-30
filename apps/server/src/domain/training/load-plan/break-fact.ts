/**
 * The `break` fact (plan D9, design §5, ADR-0009 amendment): a pause in training with its dates, a reason
 * class and the user's words. The fact text is the carrier — `break reason=<class> from=<YYYY-MM-DD>
 * to=<YYYY-MM-DD> — <words>` — so the code can read the reason back without a schema change. Written only
 * through the summariser + verifier (and, for the "asked" marker, by the code with reason `unknown`).
 */

export const BREAK_REASONS = [
  'illness',
  'injury',
  'holiday_work_no_time',
  'deliberate_deload',
  'stress_poor_sleep',
  'unknown',
] as const;
export type BreakReason = (typeof BREAK_REASONS)[number];

export interface BreakFact {
  reason: BreakReason;
  /** First day without training, `YYYY-MM-DD`. */
  from: string;
  /** Last day of the break (or the day it was asked about), `YYYY-MM-DD`. */
  to: string;
  words: string;
}

const PATTERN = /^break reason=(\w+) from=(\d{4}-\d{2}-\d{2}) to=(\d{4}-\d{2}-\d{2})(?: — (.*))?$/s;

export function formatBreakFact(fact: BreakFact): string {
  return `break reason=${fact.reason} from=${fact.from} to=${fact.to}${fact.words ? ` — ${fact.words}` : ''}`;
}

/** Null when the text is not a well-formed break fact (unknown class, bad or reversed dates). */
export function parseBreakFact(text: string): BreakFact | null {
  const m = PATTERN.exec(text.trim());
  if (!m) {
    return null;
  }
  const [, reason, from, to, words] = m;
  if (!(BREAK_REASONS as readonly string[]).includes(reason) || from > to) {
    return null;
  }
  return { reason: reason as BreakReason, from, to, words: words ?? '' };
}

/**
 * The reason of the newest break fact whose period overlaps the gap `[window.from, window.to]`
 * (`YYYY-MM-DD`); null when none does.
 */
export function breakReasonOf(
  facts: { fact: string; createdAt: Date }[],
  window: { from: string; to: string },
): BreakReason | null {
  const overlapping = facts
    .map(f => ({ parsed: parseBreakFact(f.fact), createdAt: f.createdAt }))
    .filter(
      (f): f is { parsed: BreakFact; createdAt: Date } =>
        f.parsed !== null && f.parsed.from <= window.to && f.parsed.to >= window.from,
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return overlapping[0]?.parsed.reason ?? null;
}

/** The calendar date (`YYYY-MM-DD`) of `date` in `timezone` (UTC when null) — the way break dates are written. */
export function calendarDate(date: Date, timezone: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
