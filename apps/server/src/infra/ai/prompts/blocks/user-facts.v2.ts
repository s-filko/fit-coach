import type { UserFact } from '@domain/user/ports';

import type { PromptModule, Section } from '@infra/ai/prompts/types';

export interface UserFactsContext {
  /** Ordered by category then recency, capped — what `IUserFactsService.getForPrompt` returns. */
  facts: UserFact[];
}

/** The block's stable header — cache-attribution.ts's label derivation matches on this, not a copy. */
export const USER_FACTS_HEADER = '## User Facts';

/**
 * One fact as the coach needs to read it (AC-FL-1): the text, then the metadata
 * that tells yesterday from six months ago — the phase note for a long-term
 * recovery, the confirmation count, and the absolute UTC date the fact was last
 * confirmed. Deterministic; no `now` needed for any of it.
 */
function factLine(fact: UserFact): string {
  const parts: string[] = [];
  if (fact.durability === 'long_term' && fact.phaseNote) {
    parts.push(fact.phaseNote);
  }
  parts.push(`${fact.confirmations}× confirmed`);
  parts.push(`updated ${fact.updatedAt.toISOString().slice(0, 10)}`);
  const text = fact.muscleGroup ? `${fact.fact} (${fact.muscleGroup})` : fact.fact;
  return `- ${text} — ${parts.join(' · ')}`;
}

/**
 * `## User Facts` v2 (fact-lifecycle plan Task 1, AC-FL-1): v1's grouped
 * one-line-per-fact layout, extended so every fact carries its absolute date
 * and confirmation count (and, for long_term, its phase note) — without those,
 * the model cannot tell a fact confirmed yesterday from one six months old.
 * Archived and expired facts never reach this block at all: getForPrompt /
 * getConstraints exclude them, so the block simply renders what it is given.
 *
 * Pure (BR-LLM-007): no I/O, no clock reads — the input is already-loaded data.
 */
export const USER_FACTS_V2: PromptModule<UserFactsContext> = {
  id: 'block.user_facts',
  version: 'v2',
  directives: [],
  render({ facts }): Section[] {
    if (facts.length === 0) {
      return [];
    }
    const lines: string[] = [];
    let lastCategory: string | null = null;
    for (const fact of facts) {
      if (fact.category !== lastCategory) {
        lines.push(`${fact.category}:`);
        lastCategory = fact.category;
      }
      lines.push(factLine(fact));
    }
    return [
      {
        id: 'user_facts',
        required: true,
        text: [USER_FACTS_HEADER, ...lines].join('\n'),
      },
    ];
  },
};
