import type { Scenario } from '../schema/scenario.schema';

import { pastWith } from './fl-shared';

/**
 * Journey FL-E — a plan that hits NON-permanent constraints is saved, with an
 * advisory the coach relays (course-check plan Task 3 / AC-FL-6, AC-FL-7).
 *
 * Two constraints, neither permanent: a long-term knee recovery (quads) and a
 * short lat strain (back_lats). The plan the user approves contains Barbell
 * Back Squat (quads primary) and Pull-ups (back_lats primary) next to a bench
 * press with no conflict. Before AC-FL-6 the guard hard-rejected the whole plan
 * on the first hit; now the plan must be PERSISTED and the tool result must
 * carry the advisory naming both facts and both exercises.
 *
 * The ending is in the database — a `workout_plans` row, active, with those
 * exercises inside `plan_json` — and in the run row (the tool call's outcome is
 * `ok`, not a rejection), not merely in an advisory string having been built.
 */

export const KNEE_FACT = 'Left knee: recovering from a meniscus repair';
export const LAT_FACT = 'Lat strain from rows last week';

/** Fixed catalog ids of the test database (src/app/test/setup.ts). */
const BENCH = { exerciseId: 'c7b0899c-a0f9-47ca-a69d-4bcd531b0c95', exerciseName: 'Barbell Bench Press' };
const SQUAT = { exerciseId: '3818f94a-0543-4241-83b4-6840d06a4e6a', exerciseName: 'Barbell Back Squat' };
const PULL_UPS = { exerciseId: '8c88ebce-f5df-4d33-afdb-0b096a0dd7a8', exerciseName: 'Pull-ups' };

const block = (ex: { exerciseId: string; exerciseName: string }) => ({
  ...ex,
  energyCost: 'high',
  targetSets: 3,
  targetReps: '8-10',
  restSeconds: 90,
  estimatedDuration: 12,
});

const PLAN_ARGS = {
  name: 'Upper/Lower Split',
  goal: 'Build strength',
  trainingStyle: 'Upper/Lower',
  targetMuscleGroups: ['chest', 'back_lats', 'quads'],
  recoveryGuidelines: {
    majorMuscleGroups: { minRestDays: 2, maxRestDays: 3 },
    smallMuscleGroups: { minRestDays: 1, maxRestDays: 2 },
    highIntensity: { minRestDays: 2 },
    customRules: ['Always warm up'],
  },
  sessionTemplates: [
    {
      key: 'upper_a',
      name: 'Upper A',
      focus: 'Push and pull',
      energyCost: 'high',
      estimatedDuration: 50,
      exercises: [block(BENCH), block(PULL_UPS)],
    },
    {
      key: 'lower_a',
      name: 'Lower A',
      focus: 'Quads',
      energyCost: 'high',
      estimatedDuration: 45,
      exercises: [block(SQUAT)],
    },
  ],
  progressionRules: ['Add 2.5 kg when every set reaches the top of the rep range'],
};

export const scenario: Scenario = {
  id: 'fl-e-advisory-plan',
  description:
    'A plan with a squat and pull-ups against a long-term knee fact and a short lat strain is saved — persisted, with an advisory the coach relays',
  past: pastWith([
    {
      category: 'physical_constraint',
      fact: KNEE_FACT,
      muscleGroup: 'quads',
      durability: 'long_term',
      at: '-10d',
      reviewInDays: 30,
      phaseNote: 'brace off, light loads only',
    },
    {
      category: 'physical_constraint',
      fact: LAT_FACT,
      muscleGroup: 'back_lats',
      durability: 'short',
      at: '-1d',
      ttlDays: 7,
      onExpiry: 'ask_once',
    },
  ]),
  steps: [
    {
      action: 'user',
      text: 'Составь мне план тренировок',
      script: [
        {
          toolCall: { name: 'request_transition', args: { toPhase: 'plan_creation', reason: 'the user wants a plan' } },
        },
        { text: 'Хорошо, давай соберём план.' },
      ],
      expect: {
        tools: { must: ['request_transition'] },
        phaseAfter: { phase: 'plan_creation' },
      },
    },
    {
      action: 'user',
      text: 'План хороший, сохраняй',
      script: [
        { toolCall: { name: 'save_workout_plan', args: PLAN_ARGS } },
        {
          text: 'План сохранён. Учти: приседания нагружают колено, а подтягивания — растянутую широчайшую. Если что-то беспокоит — заменим.',
        },
      ],
      expect: {
        // What the model was handed after the call: the advisory, naming both facts and both exercises.
        seen: {
          mustMatch: ['ADVISORY', KNEE_FACT, LAT_FACT, SQUAT.exerciseName, PULL_UPS.exerciseName, 'must address'],
        },
        tools: { must: ['save_workout_plan'] },
        delivered: { mustMatch: ['приседания нагружают колено'] },
        // The ending: the plan is really there, with the conflicting exercises inside it.
        persisted: {
          plans: [{ status: 'active', exercises: [BENCH.exerciseName, SQUAT.exerciseName, PULL_UPS.exerciseName] }],
          // The constraints are untouched — an advisory informs, it does not rewrite.
          facts: [
            { fact: KNEE_FACT, status: 'active', durability: 'long_term' },
            { fact: LAT_FACT, status: 'active', durability: 'short' },
          ],
        },
        phaseAfter: { phase: 'chat' },
      },
    },
  ],
};
