import type { SessionPlanningContextData } from '@domain/training/services/session-planning-context.builder';
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import type { User } from '@domain/user/services/user.service';

import { composeDirectives } from '@infra/ai/graph/prompt-directives';
import { calendarDaysAgo, formatInUserTz, humanTimeAgo } from '@shared/date-utils';

/* eslint-disable max-len */
export function buildSessionPlanningSystemPrompt(user: User | null, context: SessionPlanningContextData): string {
  const now = new Date();
  const tz = user?.timezone;
  const { dateOnly } = formatInUserTz(now, tz);

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
  const historySection = buildHistorySection(context.recentSessions, now, tz);

  // === RECOVERY TIMELINE ===
  const recoverySection = buildRecoverySection(context.recentSessions, now, tz);

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

=== YOUR TASK ===

Follow this sequence:

--- STEP 1: INTERNAL ANALYSIS (think through this before responding) ---

Using the ACTIVE WORKOUT PLAN (session templates) and RECOVERY TIMELINE above:
a) For each session template, look at its exercises and identify the primary muscle groups they target.
b) Cross-reference with the RECOVERY TIMELINE to find when those muscle groups were last trained.
c) Rank templates by how long their primary muscles have been resting — longest gap = highest priority candidate.
d) If the top candidate has primary muscles trained <2 days ago, move to the next.
e) NEGLECT OVERRIDE: If a template's primary muscles have not been trained for 10+ days, that template gets TOP PRIORITY regardless of fitness goal. Long neglect causes muscle loss and imbalance — address it first. If the client has concerns (soreness, injury, joint issues after a long break), adapt intensity (reduce weights, add warm-up sets) but still recommend that template.
f) If multiple templates are equally recovered AND none triggers the neglect override, apply GOAL PRIORITY: choose the one that best serves the client's fitnessGoal. Example: goal "V-silhouette / wide shoulders" → prefer Upper Body template over Lower Body when recovery is equal.
g) Commit to ONE recommended template with clear reasoning (recovery gap, neglect risk, goal relevance).

--- STEP 2: ASK ONE SMART QUESTION ---

Before proposing any plan, ask exactly ONE personalized question. Make it specific and contextual:
- If the recommended session follows a hard session within the last 3 days → ask about soreness in the relevant muscle group. Example: "Last time you hit chest 2 days ago — any tightness today?"
- If the recommended session targets a group not trained in a long time → ask about readiness or available time. Example: "Shoulders and arms haven't been hit in 10 days — how much time do you have today and how's your energy?"
- If it's the client's first session ever → ask about available time and energy level.

Do NOT ask multiple questions. Do NOT propose the plan yet. Wait for the client's answer.

--- STEP 3: SEARCH AND PROPOSE THE PLAN ---

After the client responds:
1. Use search_exercises to find suitable exercises for the session (by muscle group, equipment).
   Apply equipment filter if context is clear (e.g. client trains at home → equipment="bodyweight").
   You may call search_exercises multiple times in a single turn for different muscle groups.
   Once you have results with IDs, do NOT re-search the same muscle group — reuse the IDs from this conversation history.
2. Propose the session with:
   - Brief reasoning — why this template today: gap since last done, recovery status, goal relevance.
   - The exercise list with IDs from search results, sets, reps, rest times.
   - A short closing invite: "Want to swap anything or shall we go?"

--- STEP 4: REFINE ---

Adjust the plan if the client requests changes (different exercises, shorter duration, skip something).
Use search_exercises ONLY if you need exercises not yet found in this conversation. Always keep exact exercise UUIDs.

--- STEP 5: START or CANCEL ---

- When the client explicitly approves the final plan → call \`start_training_session\` with the complete plan. Never call it before confirmation.
- If the client decides not to train today → call \`request_transition({ toPhase: 'chat' })\`.

If no active plan exists → tell the client they need a workout plan first and call \`request_transition({ toPhase: 'chat' })\`.

=== TOOLS ===

- search_exercises: search exercise catalog by meaning. Call when you need exercises not yet in conversation history.
  Examples: query="chest compound barbell", muscleGroup="chest", equipment="barbell".
  Returns exercises with IDs — IDs are valid for the entire conversation, no need to re-fetch.
- start_training_session: call ONLY when user explicitly approves the final plan. Do NOT re-search before calling.
- request_transition: call with toPhase="chat" ONLY when user explicitly cancels.

CRITICAL: NEVER write JSON in your message text. NEVER output raw JSON blocks, action objects, or structured data in the message. ALL actions MUST be performed through tool calls only. Your message text must be plain conversational language only.
ANTI-PATTERN example — Bad: "{ action: 'start_training_session', args: { ... } }". Good: call the start_training_session tool directly. JSON in message text is a critical bug.

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
            exerciseId: string;
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

function buildHistorySection(sessions: WorkoutSessionWithDetails[], now: Date, tz?: string | null): string {
  if (sessions.length === 0) {
    return 'No training history yet. This will be the first session.';
  }

  return sessions
    .map((session, idx) => {
      const sessionDate = new Date(session.startedAt ?? session.createdAt);
      const timeAgo = humanTimeAgo(sessionDate, now, tz);

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

function buildRecoverySection(sessions: WorkoutSessionWithDetails[], now: Date, tz?: string | null): string {
  const lastTrainedByMuscle = new Map<string, { daysAgo: number; date: Date }>();

  for (const session of sessions) {
    const sessionDate = new Date(session.startedAt ?? session.createdAt);
    const daysAgo = calendarDaysAgo(sessionDate, now, tz);

    for (const ex of session.exercises) {
      for (const mg of (ex.exercise as { muscleGroups?: Array<{ muscleGroup: string }> }).muscleGroups ?? []) {
        const existing = lastTrainedByMuscle.get(mg.muscleGroup);
        if (!existing || daysAgo < existing.daysAgo) {
          lastTrainedByMuscle.set(mg.muscleGroup, { daysAgo, date: sessionDate });
        }
      }
    }
  }

  if (lastTrainedByMuscle.size === 0) {
    return 'No muscle group data — fully rested.';
  }

  return Array.from(lastTrainedByMuscle.entries())
    .sort((a, b) => a[1].daysAgo - b[1].daysAgo)
    .map(([muscle, { daysAgo, date }]) => {
      const when = humanTimeAgo(date, now, tz);
      const warn = daysAgo <= 2 ? '⚠ ' : '';
      const note = daysAgo <= 2 ? ' — may still be sore' : ' — likely recovered';
      return `- ${muscle}: ${warn}${when}${note}`;
    })
    .join('\n');
}
