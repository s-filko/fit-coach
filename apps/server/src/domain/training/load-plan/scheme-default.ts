import { getScheme, type ProgressionScheme, type SchemeGoal, type SchemeId } from './schemes';

/** The profile fields the default reads (`users.fitness_level`, `users.fitness_goal`). */
export interface ProgressionProfile {
  fitnessLevel?: string | null;
  fitnessGoal?: string | null;
}

export interface ProgressionChoice {
  scheme: ProgressionScheme;
  goal: SchemeGoal;
  /** `default` = unconfirmed, printed so; `user` = the `progression_scheme` fact (Task 5a). */
  source: 'default' | 'user';
  /** When the user's choice was stored — set with `source: 'user'`. */
  chosenAt?: Date;
}

const STRENGTH = /strength|stronger|сил/i;
const HYPERTROPHY = /muscle|hypertroph|bulk|mass|масс|мышц/i;

export function goalFromProfile(text: string | null | undefined): SchemeGoal {
  if (text && STRENGTH.test(text)) {
    return 'strength';
  }
  return text && HYPERTROPHY.test(text) ? 'hypertrophy' : 'general';
}

/** D8 default: novice + strength → linear, otherwise double progression. */
export function defaultProgression(profile: ProgressionProfile | null | undefined): ProgressionChoice {
  const goal = goalFromProfile(profile?.fitnessGoal);
  const id: SchemeId =
    profile?.fitnessLevel === 'beginner' && goal === 'strength' ? 'linear_progression' : 'double_progression';
  return { scheme: getScheme(id), goal, source: 'default' };
}
