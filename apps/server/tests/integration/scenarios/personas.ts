import type { Scenario } from '../../../evals/schema/scenario.schema';
import { pastWith } from '../../../evals/scenarios/fl-shared';

/**
 * The seeded persona shared by the failed-run scenarios (AC-AT-1/AC-AT-2): a registered user with
 * no history, so the only thing that varies between scenarios is the one step's message and whether
 * the scripted model throws. Same seeded user as the fact-lifecycle journeys (`fl-shared.ts`).
 */
export const ALEX_PAST: Scenario['past'] = pastWith([]);

/** A single-step scenario against `ALEX_PAST` — the model answers 'Хорошо.' unless the test scripts a failure. */
export function buildAlexScenario(id: string, description: string, text: string): Scenario {
  return {
    id,
    description,
    past: ALEX_PAST,
    steps: [{ action: 'user', text, script: [{ text: 'Хорошо.' }], expect: {} }],
  };
}
