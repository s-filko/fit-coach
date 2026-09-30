import { calendarDate } from './break-fact';
import type { ProgressionChoice } from './scheme-default';
import { getScheme, isSchemeId, type SchemeId } from './schemes';

/**
 * The `progression_scheme` fact (plan D8, A6, design §4.2, ADR-0009 amendment): the user's chosen progression
 * scheme. The fact text is the carrier — `progression_scheme id=<registry id> — <user's words>` — and the id is
 * validated against `SCHEMES` in code; an unknown id is rejected at apply time. Written only through the
 * summariser + verifier from the user's verbatim quote (never by a tool); the newest active fact is the choice.
 */

export interface ProgressionFact {
  schemeId: SchemeId;
  words: string;
}

const PATTERN = /^progression_scheme id=(\w+)(?: — (.*))?$/s;

export function formatProgressionFact(fact: ProgressionFact): string {
  return `progression_scheme id=${fact.schemeId}${fact.words ? ` — ${fact.words}` : ''}`;
}

/** Null when the text is not a well-formed fact or names an id the registry does not know. */
export function parseProgressionFact(text: string): ProgressionFact | null {
  const m = PATTERN.exec(text.trim());
  if (!m || !isSchemeId(m[1])) {
    return null;
  }
  return { schemeId: m[1], words: m[2] ?? '' };
}

export interface ChosenScheme {
  schemeId: SchemeId;
  /** When the choice was stored (the fact's `createdAt`). */
  chosenAt: Date;
}

/** The newest valid `progression_scheme` fact among the user's ACTIVE facts; null when none. */
export function chosenSchemeOf(facts: { fact: string; createdAt: Date }[]): ChosenScheme | null {
  const valid = facts
    .map(f => ({ parsed: parseProgressionFact(f.fact), createdAt: f.createdAt }))
    .filter((f): f is { parsed: ProgressionFact; createdAt: Date } => f.parsed !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return valid[0] ? { schemeId: valid[0].parsed.schemeId, chosenAt: valid[0].createdAt } : null;
}

/** The scheme in force: the user's choice if there is one (the goal stays the profile's), else the default. */
export function progressionFromChoice(base: ProgressionChoice, chosen: ChosenScheme | null): ProgressionChoice {
  if (!chosen) {
    return base;
  }
  return { ...base, scheme: getScheme(chosen.schemeId), source: 'user', chosenAt: chosen.chosenAt };
}

/**
 * `Progression: double, confirm ×2 — chosen by user 2026-09-20` (design §4.2), or `— default, unconfirmed`.
 * No rep range:
 * each exercise works on its own (today's range, else the scheme default — printed per entry), so one block never shows
 * two contradicting ranges.
 */
export function progressionLine(choice: ProgressionChoice, timezone: string | null): string {
  const params = choice.scheme.defaultParams(choice.goal);
  const [name] = choice.scheme.id.split('_');
  const provenance =
    choice.source === 'user' && choice.chosenAt
      ? `chosen by user ${calendarDate(choice.chosenAt, timezone)}`
      : 'default, unconfirmed';
  return `Progression: ${name}, confirm ×${params.confirmSessions} — ${provenance}`;
}
