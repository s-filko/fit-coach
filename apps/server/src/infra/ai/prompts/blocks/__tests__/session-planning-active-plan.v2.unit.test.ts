/**
 * plan Task 5b (D10, AC-LP-7): with the retired planner flag on, the ACTIVE WORKOUT
 * PLAN block is v2 — sets × reps only, no target weight, even for a legacy plan that still
 * carries one. v1 is untouched.
 */
import type { SessionPlanningContextData } from '@domain/training/services/session-planning-context.builder';

import { SESSION_PLANNING_ACTIVE_PLAN_V1 } from '../session-planning-active-plan.v1';
import { SESSION_PLANNING_ACTIVE_PLAN_V2 } from '../session-planning-active-plan.v2';

/** The planner context shape the block renders — only activePlan matters here. */
function dataWith(activePlan: SessionPlanningContextData['activePlan']): { context: SessionPlanningContextData } {
  return { context: { activePlan } } as { context: SessionPlanningContextData };
}

const LEGACY_PLAN = {
  id: 'plan-1',
  name: 'Upper-Lower Split',
  planJson: {
    goal: 'Build muscle',
    trainingStyle: 'Upper-Lower',
    sessionTemplates: [
      {
        key: 'upper_a',
        name: 'Upper A',
        focus: 'Push',
        energyCost: 'high',
        estimatedDuration: 60,
        exercises: [
          {
            exerciseId: 'ex-1',
            exerciseName: 'Bench Press',
            energyCost: 'high',
            targetSets: 3,
            targetReps: '8-10',
            targetWeight: 60,
            restSeconds: 90,
            estimatedDuration: 12,
          },
        ],
      },
    ],
  },
} as SessionPlanningContextData['activePlan'];

describe('session_planning.active_plan v2 — no weights (plan Task 5b, AC-LP-7)', () => {
  it('v2 keeps the block id, bumps the version', () => {
    expect(SESSION_PLANNING_ACTIVE_PLAN_V2.id).toBe(SESSION_PLANNING_ACTIVE_PLAN_V1.id);
    expect(SESSION_PLANNING_ACTIVE_PLAN_V2.version).toBe('v2');
  });

  it('v1 still prints the legacy target weight (flag off)', () => {
    const text = SESSION_PLANNING_ACTIVE_PLAN_V1.render(dataWith(LEGACY_PLAN) as never, {} as never, 0)!;
    expect(text).toContain('[ID:ex-1] Bench Press: 3x8-10 @ 60kg (rest: 90s)');
  });

  it('v2 prints sets × reps without the weight, for a legacy plan that still carries one', () => {
    const text = SESSION_PLANNING_ACTIVE_PLAN_V2.render(dataWith(LEGACY_PLAN) as never, {} as never, 0)!;
    expect(text).toContain('[ID:ex-1] Bench Press: 3x8-10 (rest: 90s)');
    expect(text).not.toContain('@ 60kg');
  });
});
