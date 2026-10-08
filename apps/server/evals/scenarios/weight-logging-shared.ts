import type { Scenario } from '../schema/scenario.schema';
import {
  BENCH_PRESS_ID,
  GREETING_AND_TRANSITION_TEXT,
  GREETING_REQUEST,
  LETS_GO,
  PLANNING_FINAL_TEXT,
  PULL_UPS_ID,
  SQUAT_ID,
} from './b-full-workout.scenario';
import { FL_USER } from './fl-shared';

/**
 * The T1 weight-logging journeys (coach-quality-proof T1 / AC-CQ-1):
 * i-weight-shorthand, j-bodyweight, k-weight-unknown, l-correction,
 * m-no-false-log — the 2026-10 findings around how a reported set's weight is
 * chosen, named, asked and corrected. Everything here runs against the
 * BR-TRAINING-047 rules merged from plan-and-tool-fixes T6: `log_set` with
 * reps always carries an explicit weight (0 = a bodyweight set), a reps-only
 * call is rejected by the schema, and the code never derives a weight.
 *
 * The journeys g/h (BUG-053) wait for plan/stale-session-autoclose and are
 * NOT part of this family yet.
 */

/** The fixed test-catalog exercises (src/app/test/setup.ts) come from journey B's exports. */
export { BENCH_PRESS_ID, PULL_UPS_ID, SQUAT_ID };

/** One planned exercise of the single-session active plan. */
export interface PlannedExercise {
  exerciseId: string;
  exerciseName: string;
  sessionKey: string;
  sessionTitle: string;
  sets: number;
  reps: string;
}

/** A past with just the user and a one-exercise active plan (no seeded history). */
export function singleExercisePast(p: PlannedExercise): Scenario['past'] {
  return {
    user: FL_USER,
    facts: [],
    plan: {
      name: 'Single Exercise Plan',
      sessions: [
        {
          key: p.sessionKey,
          title: p.sessionTitle,
          exercises: [{ exercise: p.exerciseName, sets: p.sets, reps: p.reps }],
        },
      ],
    },
    workouts: [],
  };
}

/**
 * The two setup steps every training journey of this family starts with
 * (chat → session_planning → training), plus the `+5m` advance — indices 0–2
 * mirror journey B's shape; the caller's first training turn is step 3.
 */
export function trainingSetupSteps(p: PlannedExercise, startFinalText: string): Scenario['steps'] {
  return [
    {
      action: 'user',
      text: GREETING_REQUEST,
      script: [
        {
          text: GREETING_AND_TRANSITION_TEXT,
          toolCall: { name: 'request_transition', args: { toPhase: 'session_planning', reason: 'user wants to train' } },
        },
        { text: PLANNING_FINAL_TEXT },
      ],
      expect: {
        tools: { must: ['request_transition'] },
        delivered: { mustMatch: [PLANNING_FINAL_TEXT] },
        persisted: { turnRecorded: true },
        phaseAfter: { phase: 'session_planning' },
      },
    },
    {
      action: 'user',
      text: LETS_GO,
      script: [
        {
          toolCall: {
            name: 'start_training_session',
            args: {
              sessionKey: p.sessionKey,
              sessionName: p.sessionTitle,
              reasoning: 'The active plan has one session; the user is ready to start.',
              exercises: [
                {
                  exerciseId: p.exerciseId,
                  exerciseName: p.exerciseName,
                  targetSets: p.sets,
                  targetReps: p.reps,
                  restSeconds: 120,
                },
              ],
              estimatedDuration: 45,
            },
          },
        },
        { text: startFinalText },
      ],
      expect: {
        tools: { must: ['start_training_session'] },
        delivered: { mustMatch: ['Поехали!'] },
        phaseAfter: { phase: 'training' },
        persisted: { session: { key: p.sessionKey, status: 'in_progress', hasStartedAt: true } },
      },
    },
    { action: 'advance', at: '+5m' },
  ];
}
