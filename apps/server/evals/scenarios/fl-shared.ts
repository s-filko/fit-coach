/**
 * Shared pieces of the fact-lifecycle journeys (course-check plan Task 3,
 * AC-FL-7) — the seeded user and the two scripted structured answers, so each
 * scenario module states only what is particular to its story.
 */
import type { Scenario } from '../schema/scenario.schema';

type Past = Scenario['past'];
type UserStep = Extract<Scenario['steps'][number], { action: 'user' }>;
type Structured = NonNullable<UserStep['structured']>;

/** The seeded user: registered, in chat, Europe/Berlin — the same person as journeys A-C. */
export const FL_USER: Past['user'] = {
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
};

/** A scripted course-check answer; unstated lists are empty. */
export function directive(
  d: Partial<NonNullable<Structured['courseCheck']>> & { vector: string },
): NonNullable<Structured['courseCheck']> {
  return { constraints: [], questions: [], suspectFacts: [], exerciseVerdicts: [], ...d };
}

/** A scripted summariser answer; unstated lists are empty. */
export function summary(s: Partial<NonNullable<Structured['summary']>>): NonNullable<Structured['summary']> {
  return { topics: [], decisions: [], userState: [], trainingFeedback: [], openItems: [], factOperations: [], ...s };
}

/** Builds a `past` for a journey: the shared user, no workouts, the given facts. */
export function pastWith(facts: Past['facts']): Past {
  return { user: FL_USER, workouts: [], facts };
}
