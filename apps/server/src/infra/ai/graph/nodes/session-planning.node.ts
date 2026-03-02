import type { SessionPlanningContextData } from '@domain/training/services/session-planning-context.builder';
import type { ExerciseWithMuscles, WorkoutSessionWithDetails } from '@domain/training/types';
import type { User } from '@domain/user/services/user.service';

import { composeDirectives } from '@infra/ai/graph/prompt-directives';

/* eslint-disable max-len */
export function buildSessionPlanningSystemPrompt(
  user: User | null,
  context: SessionPlanningContextData,
  exercises: ExerciseWithMuscles[],
): string {
  const now = new Date();
  const dateOnly = now.toISOString().split('T')[0] ?? '';

  // === CLIENT PROFILE ===
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

  // === ACTIVE WORKOUT PLAN ===
  const planSection = context.activePlan
    ? buildActivePlanSection(context.activePlan.name, context.activePlan.planJson)
    : 'No active workout plan. The user should create a plan first (use chat to navigate to plan creation).';

  // === RECENT TRAINING HISTORY ===
  const historySection = buildHistorySection(context.recentSessions, now);

  // === RECOVERY TIMELINE ===
  const recoverySection = buildRecoverySection(context.recentSessions, now);

  // === AVAILABLE EXERCISES ===
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
          return `- ${ex.name} (ID: ${ex.id}, Equip: ${ex.equipment ?? 'none'}${muscles ? `, ${muscles}` : ''})`;
        })
        .join('\n');
      return `### ${name}\n${list}`;
    })
    .join('\n\n');

  const daysSince =
    context.daysSinceLastWorkout !== null
      ? `${context.daysSinceLastWorkout} days since last workout`
      : 'No previous workouts';

  return `Current Date: ${dateOnly}
${daysSince}

=== CLIENT PROFILE ===

${profileSection}

=== ACTIVE WORKOUT PLAN ===

${planSection}

=== RECENT TRAINING HISTORY (last sessions) ===

${historySection}

=== RECOVERY TIMELINE (muscle groups) ===

${recoverySection}

=== AVAILABLE EXERCISES (${exercises.length} total) ===

${exercisesSection}

=== YOUR TASK ===

Follow this sequence:

--- STEP 1: INTERNAL ANALYSIS (think through this before responding) ---

Using the ACTIVE WORKOUT PLAN (session templates) and RECOVERY TIMELINE above:
a) For each session template, look at its exercises and identify the primary muscle groups they target.
b) Cross-reference with the RECOVERY TIMELINE to find when those muscle groups were last trained.
c) Rank templates by how long their primary muscles have been resting — longest gap = highest priority candidate.
d) If the top candidate has primary muscles trained <2 days ago, move to the next.
e) If multiple templates are equally recovered, apply GOAL PRIORITY: choose the one that best serves the client's fitnessGoal. Example: goal "V-silhouette / wide shoulders" → prefer Upper Body template over Lower Body when recovery is equal.
f) Commit to ONE recommended template with clear reasoning (recovery gap, goal relevance).

--- STEP 2: ASK ONE SMART QUESTION ---

Before proposing any plan, ask exactly ONE personalized question. Make it specific and contextual:
- If the recommended session follows a hard session within the last 3 days → ask about soreness in the relevant muscle group. Example: "Last time you hit chest 2 days ago — any tightness today?"
- If the recommended session targets a group not trained in a long time → ask about readiness or available time. Example: "Shoulders and arms haven't been hit in 10 days — how much time do you have today and how's your energy?"
- If it's the client's first session ever → ask about available time and energy level.

Do NOT ask multiple questions. Do NOT propose the plan yet. Wait for the client's answer.

--- STEP 3: PROPOSE THE PLAN ---

After the client responds, propose the session with:
1. Brief reasoning — why this template today: gap since last done, recovery status, and how it serves their goal.
2. The exercise list with IDs, sets, reps, rest times.
3. A short closing invite: "Want to swap anything or shall we go?"

--- STEP 4: REFINE ---

Adjust the plan if the client requests changes (different exercises, shorter duration, skip something). Always keep exact numeric exercise IDs.

--- STEP 5: START or CANCEL ---

- When the client explicitly approves the final plan → call \`start_training_session\` with the complete plan. Never call it before confirmation.
- If the client decides not to train today → call \`request_transition({ toPhase: 'chat' })\`.

If no active plan exists → tell the client they need a workout plan first and call \`request_transition({ toPhase: 'chat' })\`.

--- OFF-TOPIC GUARD ---

If the user's message is NOT about session planning (choosing a workout, exercises, sets, reps, weights, scheduling, recovery, or starting/cancelling a session):
1. Ask ONE short contextual question to clarify whether they want to stop planning.
   Keep it natural and tied to the current context. Examples:
   - "good night" → "Спокойной ночи! Тренировку на сегодня откладываем?"
   - non-fitness question → "Понял! Планирование сессии ставим на паузу?"
   - "thanks, bye" → "Удачи! Сессию оставляем на потом?"
2. If the user confirms leaving OR their next message is still not about session planning → call \`request_transition({ toPhase: 'chat', reason: 'off_topic' })\`.
3. If the user says they want to continue planning → stay and proceed normally.

${composeDirectives(user)}`;
}

function buildActivePlanSection(
  name: string,
  planJson:
    | {
        goal?: string;
        trainingStyle?: string;
        sessionTemplates?: Array<{
          key: string;
          name: string;
          focus: string;
          estimatedDuration: number;
          exercises: Array<{
            exerciseId: number;
            exerciseName: string;
            targetSets: number;
            targetReps: string;
            targetWeight?: number;
            restSeconds: number;
          }>;
        }>;
      }
    | undefined
    | null,
): string {
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

function buildHistorySection(sessions: WorkoutSessionWithDetails[], now: Date): string {
  if (sessions.length === 0) {
    return 'No training history yet. This will be the first session.';
  }

  return sessions
    .map((session, idx) => {
      const sessionDate = new Date(session.startedAt ?? session.createdAt);
      const daysAgo = Math.floor((now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24));
      const hoursAgo = Math.floor((now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60));
      const timeAgo = daysAgo > 0 ? `${daysAgo}d ago` : `${hoursAgo}h ago`;

      const exerciseList = session.exercises
        .map(ex => {
          const setsInfo = ex.sets
            .map(s => {
              if (s.setData.type === 'strength') {
                const w = s.setData.weight ?? 'BW';
                return `${s.setData.reps}x${w}${s.setData.weightUnit ?? 'kg'}`;
              }
              return `${s.setData.type}`;
            })
            .join(', ');
          return `    - ${ex.exercise.name}: ${setsInfo || 'no sets logged'}`;
        })
        .join('\n');

      return [
        `${idx + 1}. ${session.sessionKey ?? 'Custom'} (${timeAgo}) — ${session.status} — ${session.durationMinutes ?? '?'} min`,
        exerciseList || '    (no exercises logged)',
      ].join('\n');
    })
    .join('\n\n');
}

function buildRecoverySection(sessions: WorkoutSessionWithDetails[], now: Date): string {
  const lastTrainedByMuscle = new Map<string, number>();

  for (const session of sessions) {
    const sessionDate = new Date(session.startedAt ?? session.createdAt);
    const daysAgo = Math.floor((now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24));

    for (const ex of session.exercises) {
      for (const mg of (ex.exercise as { muscleGroups?: Array<{ muscleGroup: string }> }).muscleGroups ?? []) {
        const existing = lastTrainedByMuscle.get(mg.muscleGroup);
        if (existing === undefined || daysAgo < existing) {
          lastTrainedByMuscle.set(mg.muscleGroup, daysAgo);
        }
      }
    }
  }

  if (lastTrainedByMuscle.size === 0) {
    return 'No muscle group data — fully rested.';
  }

  return Array.from(lastTrainedByMuscle.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([muscle, daysAgo]) => {
      let status: string;
      if (daysAgo === 0) {
        status = '⚠ trained today';
      } else if (daysAgo === 1) {
        status = '⚠ trained yesterday';
      } else if (daysAgo <= 2) {
        status = `${daysAgo}d ago — may still be sore`;
      } else {
        status = `${daysAgo}d ago — likely recovered`;
      }
      return `- ${muscle}: ${status}`;
    })
    .join('\n');
}
