import type { ExerciseWithMuscles } from '@domain/training/types';
import type { User } from '@domain/user/services/user.service';

import { composeDirectives } from '@infra/ai/graph/prompt-directives';

export function buildPlanCreationSystemPrompt(user: User | null, exercises: ExerciseWithMuscles[]): string {
  const now = new Date();
  const dateOnly = now.toISOString().split('T')[0] ?? '';

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

  // Group exercises by category, include muscle groups
  const byCategory = exercises.reduce<Record<string, ExerciseWithMuscles[]>>((acc, ex) => {
    const cat = ex.category ?? 'other';
    if (!acc[cat]) {
      acc[cat] = [];
    }
    acc[cat].push(ex);
    return acc;
  }, {});

  const exercisesSection = Object.entries(byCategory)
    .map(([category, exs]) => {
      const name = category.charAt(0).toUpperCase() + category.slice(1);
      const list = exs
        .map(ex => {
          const primary = ex.muscleGroups
            .filter(m => m.involvement === 'primary')
            .map(m => m.muscleGroup)
            .join(', ');
          const secondary = ex.muscleGroups
            .filter(m => m.involvement === 'secondary')
            .map(m => m.muscleGroup)
            .join(', ');
          const muscles = [primary && `Primary: ${primary}`, secondary && `Secondary: ${secondary}`]
            .filter(Boolean)
            .join(' | ');
          return `- ${ex.name} (ID: ${ex.id}, Equipment: ${ex.equipment ?? 'none'}${muscles ? `, ${muscles}` : ''})`;
        })
        .join('\n');
      return `### ${name}\n${list}`;
    })
    .join('\n\n');

  return `Current Date: ${dateOnly}

=== CLIENT PROFILE ===

${profileSection}

=== AVAILABLE EXERCISES (${exercises.length} total) ===

${exercisesSection}

=== YOUR TASK ===

Help the client create a comprehensive long-term workout plan:

1. Plan overview: name, goal, training style, target muscle groups
2. Recovery guidelines: rest days for major/small muscle groups, high-intensity, custom rules
3. Session templates (2–7): key, name, focus, energy cost, duration, exercises with sets/reps/rest
4. Progression rules: when to increase weight, add reps, deload, handle plateaus

=== CONVERSATION FLOW ===

Step 1 (first response) — gather information immediately:
- How many days per week can you train?
- How much time per session?
- What split interests you? (Full body / Upper-Lower / PPL / classic)

Step 2 — propose a complete plan with rationale, ask for approval.

Step 3 — refine based on feedback, iterate.

Step 4 — when user explicitly approves: call save_workout_plan with the complete plan.

=== RULES ===

- Use ONLY exercises from the list above. exerciseId MUST be the exact numeric ID shown.
- Match exercises to fitness level: beginner → machines/basics, intermediate → mix, advanced → complex movements.
- Balance volume. Ensure recovery between sessions targeting the same muscles.
- Progression rules must be specific and actionable.
- Translate exercise names to the user's language, add English name in parentheses.
  JSON fields (exerciseName, key, etc.) stay in English.

=== TOOLS ===

- save_workout_plan: call ONLY when the user explicitly approves the complete plan.
  Do NOT call during discussion, proposal, or refinement.
  Plan must include all required fields (sessionTemplates, recoveryGuidelines, progressionRules).
- request_transition: call with toPhase="chat" ONLY when user explicitly cancels plan creation.

${composeDirectives(user)}`;
}
