/**
 * `session_planning.active_plan` v2 (load-plan plan Task 5b, D10, AC-LP-7): the v1 render with
 * `omitTargetWeights` — sets × reps only, even for a legacy plan that still carries a targetWeight
 * (the DB column stays; it is simply not written). Loads come from LOAD PLAN during training.
 * Selected only with LOAD_PLAN_PLANNER_REBIND on (session-planning.spec.ts).
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
