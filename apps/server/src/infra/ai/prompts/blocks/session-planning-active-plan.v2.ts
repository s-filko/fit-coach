/**
 * `session_planning.active_plan` v2 (plan Task 5b, D10, AC-LP-7): the v1 render with
 * `omitTargetWeights` — sets × reps only, even for a legacy plan that still carries a targetWeight
 * (the DB column stays; it is simply not written). Loads are set by the coach during the workout.
 * The only active-plan block the planning phase renders (coach-simplification I1).
 */
import {
  buildActivePlanSection,
  SESSION_PLANNING_ACTIVE_PLAN_V1,
  type SessionPlanningActivePlanData,
} from './session-planning-active-plan.v1';
import type { ContextBlock } from './types';

export const SESSION_PLANNING_ACTIVE_PLAN_V2: ContextBlock<SessionPlanningActivePlanData> = {
  id: SESSION_PLANNING_ACTIVE_PLAN_V1.id,
  version: 'v2',
  render(data) {
    const { activePlan } = data.context;
    const planSection = activePlan
      ? buildActivePlanSection(activePlan.name, activePlan.planJson, { omitTargetWeights: true })
      : 'No active workout plan. The user should create a plan first (use chat to navigate to plan creation).';
    return `=== ACTIVE WORKOUT PLAN ===\n\n${planSection}`;
  },
};
