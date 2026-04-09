/* eslint-disable max-lines-per-function */
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import { User } from '@domain/user/services/user.service';

import { composeDirectives } from '@infra/ai/graph/prompt-directives';
import { humanTimeAgo } from '@shared/date-utils';

/**
 * Builds the system prompt for the chat phase.
 * No JSON format required — LLM responds with natural text.
 * Side effects (profile updates, phase transitions) go through tool calls.
 */
export function buildChatSystemPrompt(
  user: User | null,
  hasActivePlan: boolean,
  recentSessions: WorkoutSessionWithDetails[] = [],
  lastMessageTime: Date | null = null,
): string {
  const profile = [
    user?.age && `Age: ${user.age}`,
    user?.gender && `Gender: ${user.gender}`,
    user?.height && `Height: ${user.height} cm`,
    user?.weight && `Weight: ${user.weight} kg`,
    user?.fitnessLevel && `Fitness level: ${user.fitnessLevel}`,
    user?.fitnessGoal && `Goal: ${user.fitnessGoal}`,
  ]
    .filter(Boolean)
    .join(', ');

  const planStatus = hasActivePlan
    ? 'User HAS an active workout plan. They can start planning workout sessions.'
    : 'User DOES NOT have a workout plan yet. Suggest creating one when appropriate.';

  const recentSessionsSection =
    recentSessions.length > 0
      ? recentSessions
          .map(s => {
            const date = s.completedAt ?? s.startedAt ?? s.createdAt;
            const when = humanTimeAgo(new Date(date), new Date(), user?.timezone);
            const exercises = s.exercises.map(ex => `${ex.exercise.name} (${ex.sets.length} sets)`).join(', ');
            return `- ${s.sessionKey ?? 'session'} — ${when}, ${s.durationMinutes ?? '?'} min: ${exercises || 'no exercises logged'}`;
          })
          .join('\n')
      : 'No recent sessions.';

  const clientName = user?.firstName ?? null;

  const planRule = hasActivePlan
    ? 'When the user wants to train/start a workout/plan today\'s session, IMMEDIATELY call request_transition({ toPhase: "session_planning" }). Do NOT give workout advice directly from chat.'
    : 'Suggest creating a workout plan if user wants to train. Call request_transition({ toPhase: "plan_creation" }) when user agrees.';

  return `CLIENT NAME: ${clientName ?? 'not provided'}
CLIENT PROFILE: ${profile || 'Not available'}
WORKOUT PLAN STATUS: ${planStatus}
RECENT TRAINING HISTORY (last 5 sessions):
${recentSessionsSection}

RULES:
1. SCOPE: Only discuss fitness, training, nutrition, health, wellness. Redirect anything else.
2. PERSONALIZATION: Consider the client profile when giving advice.
3. STYLE: Brief, motivating, conversational. Minimal emoji.
4. PROACTIVE: On "hi"/"hello" — greet and suggest something fitness-related.
5. WORKOUT PLAN: ${planRule}

TOOLS (use when needed):
- update_profile: when user wants to change their name, age, gender, weight, height, fitness level, or goal.
- request_transition toPhase="plan_creation": when user explicitly wants to create a workout plan.
- request_transition toPhase="session_planning": when user wants to train today / start a session / plan a workout.
  ALWAYS use this tool — never describe workouts yourself from chat.
  ANTI-PATTERN: announcing a transition in text WITHOUT calling request_transition.
  Text alone does not trigger a transition — only the tool call does.
  Always call the tool; your text accompanies the call, not replaces it.

IMPORTANT: You do NOT have log_set or any set-logging capability. You CANNOT save workout sets.
NEVER write "✅", "logged", "saved", "recorded" about sets.
If the user reports a set, transition to training or tell them to start a session first.

${composeDirectives(user, { lastMessageTime })}`;
}
