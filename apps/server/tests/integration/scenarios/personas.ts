import type { Scenario } from '../../../evals/schema/scenario.schema';

/**
 * The seeded persona shared by the failed-run scenarios (AC-AT-1/AC-AT-2): a registered user with
 * no history, so the only thing that varies between scenarios is the one step's message and whether
 * the scripted model throws.
 */
export const ALEX_PAST: Scenario['past'] = {
  user: {
    languageCode: 'ru',
    timezone: 'Europe/Berlin',
    firstName: 'Alex',
    age: 30,
    gender: 'male',
    height: 180,
    weight: 80,
    fitnessLevel: 'intermediate',
    fitnessGoal: 'strength',
    registrationCompleted: true,
  },
  workouts: [],
  facts: [],
};

/** A single-step scenario against `ALEX_PAST` — the model answers 'Хорошо.' unless the test scripts a failure. */
export function buildAlexScenario(id: string, description: string, text: string): Scenario {
  return {
    id,
    description,
    past: ALEX_PAST,
    steps: [{ action: 'user', text, script: [{ text: 'Хорошо.' }], expect: {} }],
  };
}
