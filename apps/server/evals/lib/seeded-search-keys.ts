import { buildSearchKey } from '@infra/ai/graph/tool-policy';

import type { EvalCase } from '../schema/case.schema';

/**
 * D-N (AC-1344): the search keys already present in a case's seeded
 * `tool_call` messages. A run that re-issues any of these keys — or repeats
 * one of its own earlier search keys — fails `no_redundant_search`.
 */
export function seededSearchKeys(testCase: EvalCase): Set<string> {
  const keys = new Set<string>();
  for (const message of testCase.state?.messages ?? []) {
    if (message.role === 'tool_call' && message.name === 'search_exercises') {
      keys.add(buildSearchKey(message.args));
    }
  }
  return keys;
}
