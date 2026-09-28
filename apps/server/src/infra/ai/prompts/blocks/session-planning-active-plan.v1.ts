/**
 * `session_planning.active_plan` block (D-B) — moved verbatim from
 * `prompts/phases/session_planning/v1.ts`'s `active_plan` section (P4
 * context-budget plan, Task 2).
 */
import type { SessionPlanningContextData } from '@domain/training/services/session-planning-context.builder';

import type { ContextBlock } from './types';

type ActivePlanJson = NonNullable<SessionPlanningContextData['activePlan']>['planJson'];

export function buildActivePlanSection(name: string, planJson: ActivePlanJson): string {
  if (!planJson) {
    return `Plan: ${name}\n(Plan details not available)`;
  }

  const lines = [
    `Plan: ${name}`,
    `Goal: ${planJson.goal ?? '?'}`,
    `Style: ${planJson.trainingStyle ?? '?'}`,
    '',
    'Session Templates:',
  ];

  for (const template of planJson.sessionTemplates ?? []) {
    lines.push(`\n### ${template.name} (key: ${template.key})`);
    lines.push(`Focus: ${template.focus} | Est. ${template.estimatedDuration} min`);
    lines.push('Exercises:');
    for (const ex of template.exercises) {
      const weight = ex.targetWeight ? ` @ ${ex.targetWeight}kg` : '';
      lines.push(
        `  - [ID:${ex.exerciseId}] ${ex.exerciseName}: ${ex.targetSets}x${ex.targetReps}${weight} (rest: ${ex.restSeconds}s)`,
      );
    }
  }

  return lines.join('\n');
}

export interface SessionPlanningActivePlanData {
  context: SessionPlanningContextData;
}

export const SESSION_PLANNING_ACTIVE_PLAN_V1: ContextBlock<SessionPlanningActivePlanData> = {
  id: 'session_planning.active_plan',
  version: 'v1',
  render(data) {
    const { activePlan } = data.context;
    const planSection = activePlan
      ? buildActivePlanSection(activePlan.name, activePlan.planJson)
      : 'No active workout plan. The user should create a plan first (use chat to navigate to plan creation).';
    return `=== ACTIVE WORKOUT PLAN ===\n\n${planSection}`;
  },
};
