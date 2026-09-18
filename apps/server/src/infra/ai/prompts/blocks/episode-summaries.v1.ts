import type { StoredEpisodeSummary } from '@domain/conversation/episode';

import type { PromptModule, Section } from '@infra/ai/prompts/types';

import { calendarDaysAgo } from '@shared/date-utils';

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

function relativeDate(endedAt: string, now: Date, timezone: string | null): string {
  const days = calendarDaysAgo(new Date(endedAt), now, timezone ?? undefined);
  if (days <= 0) {
    return 'today';
  }
  if (days === 1) {
    return 'yesterday';
  }
  return `${days} days ago`;
}

/** D-C: one deterministic paragraph per episode — also what `SummaryPort.insert` stores as `rendered`. */
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
export const EPISODE_SUMMARIES_V1: PromptModule<EpisodeSummariesContext> = {
  id: 'block.episode_summaries',
  version: 'v1',
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
          '## Previous episodes',
          'Context only. Numbers below are not authoritative — use tools and the current state.',
          ...summaries.map(s => episodeParagraph(s, now, timezone)),
        ].join('\n'),
      },
    ];
  },
};
