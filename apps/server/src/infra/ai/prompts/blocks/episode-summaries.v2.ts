import type { StoredEpisodeSummary } from '@domain/conversation/episode';

import type { PromptModule, Section } from '@infra/ai/prompts/types';

import { calendarDaysAgo, formatInUserTz } from '@shared/date-utils';

export interface EpisodeSummariesContext {
  /** Max 3, oldest first — what state's `episodeSummaries` holds. */
  summaries: StoredEpisodeSummary[];
  now: Date;
  timezone: string | null;
}

/** D-C: deterministic rendering — P6 reads `userState` without re-parsing prose. */
function renderList(label: string, items: string[]): string | null {
  if (items.length === 0) {
    return null;
  }
  return `${label}: ${items.join('; ')}`;
}

/**
 * v2 (AC-SI-5c, BUG-038 part 2, session-investigation-0925 F6/F7): a
 * same-day entry now carries the local time of day ("today 16:05"), not a
 * bare "today" — several episodes ended the same day are otherwise
 * byte-identical and their order is unknowable to the model. Older entries
 * are unchanged (v1's "yesterday" / "N days ago").
 */
function relativeDate(endedAt: string, now: Date, timezone: string | null): string {
  const days = calendarDaysAgo(new Date(endedAt), now, timezone ?? undefined);
  if (days <= 0) {
    const { time } = formatInUserTz(new Date(endedAt), timezone);
    return `today ${time}`;
  }
  if (days === 1) {
    return 'yesterday';
  }
  return `${days} days ago`;
}

/**
 * D-C-style: one deterministic paragraph per episode — also what `SummaryPort.insert` stores as `rendered`.
 * D-D (P6 Task 2, verified 2026-09-19): this function names its five fields explicitly rather than
 * iterating `s.summary` generically — adding `EpisodeSummary.facts` therefore does NOT change this
 * function's output. No change was needed here for Task 2; this comment records that it was checked.
 */
export function episodeParagraph(s: StoredEpisodeSummary, now: Date, timezone: string | null): string {
  const parts = [
    renderList('Topics', s.summary.topics),
    renderList('Decisions', s.summary.decisions),
    renderList('User state', s.summary.userState),
    renderList('Training feedback', s.summary.trainingFeedback),
    renderList('Open items', s.summary.openItems),
  ].filter((p): p is string => p !== null);
  return `${s.phaseAtEnd} (${relativeDate(s.endedAt, now, timezone)}): ${parts.join('. ')}.`;
}

/**
 * `## Previous episodes` (D-C, ADR-0013 §3.4 block 2): one paragraph per
 * episode, oldest first — phase, relative date, then the five structured
 * lists. The header states these are context, NOT data: facts (weights,
 * reps, session state) never come from a summary, only from tools and the
 * current state (INV-LLM-003, owner rule).
 */
/** The block's stable header — cache-attribution.ts's label derivation matches on this, not a copy. */
export const EPISODE_SUMMARIES_HEADER = '## Previous episodes';

export const EPISODE_SUMMARIES_V2: PromptModule<EpisodeSummariesContext> = {
  id: 'block.episode_summaries',
  version: 'v2',
  directives: [],
  render({ summaries, now, timezone }): Section[] {
    if (summaries.length === 0) {
      return [];
    }
    return [
      {
        id: 'episode_summaries',
        required: true,
        text: [
          EPISODE_SUMMARIES_HEADER,
          'Context only. Numbers below are not authoritative — use tools and the current state.',
          ...summaries.map(s => episodeParagraph(s, now, timezone)),
        ].join('\n'),
      },
    ];
  },
};
