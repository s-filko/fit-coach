import { renderDirectives } from '@infra/ai/prompts/compose';
import { DEFAULT_DIRECTIVES_V1 } from '@infra/ai/prompts/directives';
import type { DirectiveContext, PromptModule, Section } from '@infra/ai/prompts/types';

import { formatInUserTz } from '@shared/date-utils';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- v1 adds no fields
export interface PlanCreationPromptContext extends DirectiveContext {}

const TASK_TEXT = `=== YOUR TASK ===

Help the client create a comprehensive long-term workout plan:

1. Plan overview: name, goal, training style, target muscle groups
2. Recovery guidelines: rest days for major/small muscle groups, high-intensity, custom rules
3. Session templates (2–7): key, name, focus, energy cost, duration, exercises with sets/reps/rest
4. Progression rules: when to increase weight, add reps, deload, handle plateaus`;

const FLOW_TEXT = `=== CONVERSATION FLOW ===

Step 1 (first response) — gather information immediately:
- How many days per week can you train?
- How much time per session?
- What split interests you? (Full body / Upper-Lower / PPL / classic)

Step 2 — use search_exercises to find suitable exercises for each session template.
  Search by muscle group and equipment that matches the client's context.
  You may call search_exercises multiple times in a single turn (once per muscle group / session focus).
  Once you have results with IDs, cache them — do NOT re-search the same muscle group or query again later.

Step 3 — propose a complete plan with rationale, ask for approval.

Step 4 — refine based on feedback. Re-search ONLY if the user requests different exercises or equipment.

Step 5 — when user explicitly approves: call save_workout_plan using the IDs already found. Do NOT re-search.`;

const RULES_TEXT = `=== RULES ===

- Use search_exercises to find exercises before proposing them.
  IDs from search results are valid for the entire conversation — reuse them, never re-fetch the same query.
- Match exercises to fitness level: beginner → machines/basics, intermediate → mix, advanced → complex movements.
- Apply equipment and category filters in search_exercises when the context clearly constrains the search.
- Balance volume. Ensure recovery between sessions targeting the same muscles.
- Progression rules must be specific and actionable.
- Translate exercise names to the user's language, add English name in parentheses.
  JSON fields (exerciseName, key, etc.) stay in English.`;

const TOOLS_TEXT = `=== TOOLS ===

- search_exercises: search exercise catalog by meaning. Call when you need new exercises not yet in context.
  Examples: query="chest compound barbell press", equipment="barbell", category="compound".
  Returns exercises with IDs — use these exact IDs everywhere.
  Results persist in conversation history, no need to repeat.
- save_workout_plan: call ONLY when the user explicitly approves the complete plan.
  Do NOT call during discussion, proposal, or refinement. Do NOT re-search exercises before saving.
  Plan must include all required fields (sessionTemplates, recoveryGuidelines, progressionRules).
- request_transition: call with toPhase="chat" ONLY when user explicitly cancels plan creation.`;

/** Moved verbatim from graph/nodes/plan-creation.node.ts (P2, AC-1321 — snapshot-arbitered). */
export const PLAN_CREATION_V1: PromptModule<PlanCreationPromptContext> = {
  id: 'phase.plan_creation',
  version: 'v1',
  directives: DEFAULT_DIRECTIVES_V1,
  render(ctx: PlanCreationPromptContext): Section[] {
    const { user } = ctx;
    const { dateOnly } = formatInUserTz(ctx.now, user?.timezone);

    const profileSection = user
      ? [
          `Name: ${user.firstName ?? 'Unknown'}`,
          `Age: ${user.age ?? '?'}`,
          `Gender: ${user.gender ?? '?'}`,
          `Height: ${user.height ?? '?'} cm`,
          `Weight: ${user.weight ?? '?'} kg`,
          `Fitness Level: ${user.fitnessLevel ?? '?'}`,
          `Fitness Goal: ${user.fitnessGoal ?? '?'}`,
        ].join('\n')
      : 'Profile not loaded.';

    return [
      { id: 'date', required: true, text: `Current Date: ${dateOnly}` },
      { id: 'client_profile', required: true, text: `=== CLIENT PROFILE ===\n\n${profileSection}` },
      { id: 'task', required: true, text: TASK_TEXT },
      { id: 'conversation_flow', required: true, text: FLOW_TEXT },
      { id: 'rules', required: true, text: RULES_TEXT },
      { id: 'tools', required: true, text: TOOLS_TEXT },
      ...renderDirectives(DEFAULT_DIRECTIVES_V1, ctx),
    ];
  },
};
