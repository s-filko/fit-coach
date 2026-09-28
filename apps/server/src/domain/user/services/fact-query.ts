// fact-query (BUG-020): when the model has no factId, `manage_fact`'s
// `factQuery` — free text, what the user called the fact — must resolve to the
// active facts it refers to. Pure, case-insensitive, no scoring: a normalised
// substring match, with ties returned as ambiguity for the caller to resolve.

import { computeFactKey } from './fact-key';

/** The slice of a fact the matcher reads. */
export interface QueryableFact {
  id: string;
  fact: string;
}

/**
 * The active facts whose text contains the normalised query (or vice versa is
 * NOT counted — one direction keeps the rule dumb and predictable). Ties are
 * returned together: the caller must not guess between them.
 */
export function matchFactsByQuery<T extends QueryableFact>(facts: readonly T[], query: string): T[] {
  const needle = computeFactKey(query);
  if (needle.length === 0) {
    return [];
  }
  return facts.filter(fact => computeFactKey(fact.fact).includes(needle));
}
