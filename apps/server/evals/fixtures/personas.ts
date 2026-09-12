import type { EvalFixture } from '../schema/case.schema';

/**
 * Three fixtures every L0 check renders against — §4.1: empty, complete, active session.
 * BR-EVAL-003: hand-written personas only, no real user data.
 */
export const EMPTY_PROFILE: EvalFixture = {
  user: { languageCode: 'ru', timezone: 'Europe/Berlin', firstName: 'Тест', registrationCompleted: false },
  hasActivePlan: false,
};

export const COMPLETE_PROFILE: EvalFixture = {
  user: {
    languageCode: 'ru',
    timezone: 'Europe/Berlin',
    firstName: 'Тест',
    age: 34,
    gender: 'male',
    height: 182,
    weight: 84.5,
    fitnessLevel: 'intermediate',
    fitnessGoal: 'strength',
    registrationCompleted: true,
  },
  hasActivePlan: true,
};

export const ACTIVE_SESSION: EvalFixture = {
  ...COMPLETE_PROFILE,
  activeSession: { id: 'session-1', sessionKey: 'Upper A' },
};

export const ALL_FIXTURES: Array<{ name: string; fixture: EvalFixture }> = [
  { name: 'empty-profile', fixture: EMPTY_PROFILE },
  { name: 'complete-profile', fixture: COMPLETE_PROFILE },
  { name: 'active-session', fixture: ACTIVE_SESSION },
];
