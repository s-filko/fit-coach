import type { UserFact } from '@domain/user/ports';

import type { PromptModule, Section } from '@infra/ai/prompts/types';

export interface UserFactsContext {
  /** Ordered by category then recency, capped — what `IUserFactsService.getForPrompt` returns. */
  facts: UserFact[];
}

/**
 * D-C-style: one line per fact, muscle group appended in parens when set.
 * Deterministic — no re-parsing, no LLM call.
 */
function factLine(fact: UserFact): string {
  return fact.muscleGroup ? `${fact.fact} (${fact.muscleGroup})` : fact.fact;
}

/**
 * `## User Facts` (D-F, ADR-0013 §3.4 block 2, P6 Task 4): durable, cross-episode
 * facts about the user — extracted only at compaction (Task 3), never by a
 * per-turn tool. Rendered ahead of `## Previous episodes` (long-term memory
 * precedes episode memory). Grouped by category, in the order `facts` already
 * arrives (category then recency — the caller's `getForPrompt` contract), one
 * line per fact. Zero facts renders nothing — not an empty heading.
 *
 * Pure (BR-LLM-007): no I/O, no clock reads — the input is already-loaded data.
 */
export const USER_FACTS_V1: PromptModule<UserFactsContext> = {
  id: 'block.user_facts',
  version: 'v1',
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
      lines.push(`- ${factLine(fact)}`);
    }
    return [
      {
        id: 'user_facts',
        required: true,
        text: ['## User Facts', ...lines].join('\n'),
      },
    ];
  },
};
