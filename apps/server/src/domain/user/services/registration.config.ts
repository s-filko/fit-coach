import type { ParsedProfileData } from './user.service';

/**
 * Centralized registration flow.
 * Single source of truth for steps, order, and fields per step.
 */
export type ProfileStatus =
  | 'incomplete'
  | 'collecting_basic'
  | 'collecting_level'
  | 'collecting_goals'
  | 'confirmation'
  | 'complete';

export type ProfileDataKey = keyof ParsedProfileData;

export interface RegistrationStepConfig {
  id: ProfileStatus;
  /** Next step when this step is completed; null for 'complete'. */
  nextStep: ProfileStatus | null;
  /** Fields collected in this step (used for context and validation). */
  fieldsToCollect: ProfileDataKey[];
  /** Step uses LLM for response (greeting, level, goals, confirmation). */
  useLlm: boolean;
}

export const REGISTRATION_STEPS: RegistrationStepConfig[] = [
  {
    id: 'incomplete',
    nextStep: 'collecting_basic',
    fieldsToCollect: [],
    useLlm: true,
  },
  {
    id: 'collecting_basic',
    nextStep: 'collecting_level',
    fieldsToCollect: ['age', 'gender', 'height', 'weight'],
    useLlm: false,
  },
  {
    id: 'collecting_level',
    nextStep: 'collecting_goals',
    fieldsToCollect: ['fitnessLevel'],
    useLlm: true,
  },
  {
    id: 'collecting_goals',
    nextStep: 'confirmation',
    fieldsToCollect: ['fitnessGoal'],
    useLlm: true,
  },
  {
    id: 'confirmation',
    nextStep: null,
    fieldsToCollect: [],
    useLlm: true,
  },
  {
    id: 'complete',
    nextStep: null,
    fieldsToCollect: [],
    useLlm: false,
  },
];

const stepsById = new Map<ProfileStatus, RegistrationStepConfig>(
  REGISTRATION_STEPS.map((s) => [s.id, s]),
);

export function getStepConfig(status: ProfileStatus | string | null | undefined): RegistrationStepConfig | undefined {
  const id = (status ?? 'incomplete') as ProfileStatus;
  return stepsById.get(id);
}

export function getNextStep(current: ProfileStatus | string | null | undefined): ProfileStatus | null {
  const config = getStepConfig(current);
  return config?.nextStep ?? null;
}

export function getOrderedStepIds(): ProfileStatus[] {
  return REGISTRATION_STEPS.map((s) => s.id);
}
