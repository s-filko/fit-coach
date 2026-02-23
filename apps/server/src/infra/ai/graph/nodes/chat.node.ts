/* eslint-disable max-lines-per-function */
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import { User } from '@domain/user/services/user.service';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function formatSessionAge(date: Date): string {
  const daysAgo = Math.floor((Date.now() - date.getTime()) / MS_PER_DAY);
  if (daysAgo === 0) { return 'today'; }
  if (daysAgo === 1) { return 'yesterday'; }
  return `${daysAgo} days ago`;
}

/**
 * Builds the system prompt for the chat phase.
 * No JSON format required — LLM responds with natural text.
 * Side effects (profile updates, phase transitions) go through tool calls.
 */
export function buildChatSystemPrompt(
  user: User | null,
  hasActivePlan: boolean,
  recentSessions: WorkoutSessionWithDetails[] = [],
): string {
  const profile = [
    user?.age && `Age: ${user.age}`,
    user?.gender && `Gender: ${user.gender}`,
    user?.height && `Height: ${user.height} cm`,
    user?.weight && `Weight: ${user.weight} kg`,
    user?.fitnessLevel && `Fitness level: ${user.fitnessLevel}`,
    user?.fitnessGoal && `Goal: ${user.fitnessGoal}`,
  ].filter(Boolean).join(', ');

  const planStatus = hasActivePlan
    ? 'User HAS an active workout plan. They can start planning workout sessions.'
    : 'User DOES NOT have a workout plan yet. Suggest creating one when appropriate.';

  const recentSessionsSection = recentSessions.length > 0
    ? recentSessions.map((s) => {
        const date = s.completedAt ?? s.startedAt ?? s.createdAt;
        const when = formatSessionAge(new Date(date));
        const exercises = s.exercises
          .map((ex) => `${ex.exercise.name} (${ex.sets.length} sets)`)
          .join(', ');
        return `- ${s.sessionKey ?? 'session'} — ${when}, ${s.durationMinutes ?? '?'} min: ${exercises || 'no exercises logged'}`;
      }).join('\n')
    : 'No recent sessions.';

  const clientName = user?.firstName ?? null;
  const langInstruction = user?.languageCode
    ? `USER LANGUAGE (from Telegram): '${user.languageCode}'. Always respond in this language.`
    : 'Respond in the same language the user writes in.';

  const planRule = hasActivePlan
    ? 'Guide user to plan a session when they want to train.'
    : 'Suggest creating a workout plan if user wants to train.';

  return `Your name is FitCoach. You are a professional fitness coach and personal trainer.
You are NOT an AI assistant — you are a real fitness coach. Always stay in character.

CLIENT NAME: ${clientName ?? 'not provided'}
CLIENT PROFILE: ${profile || 'Not available'}
WORKOUT PLAN STATUS: ${planStatus}
RECENT TRAINING HISTORY (last 5 sessions):
${recentSessionsSection}

${langInstruction}

RULES:
1. IDENTITY: You are FitCoach. Never mention AI, language models, or tech companies.
2. SCOPE: Only discuss fitness, training, nutrition, health, wellness. Redirect anything else.
3. PERSONALIZATION: Consider the client profile when giving advice.
4. STYLE: Brief, motivating, conversational. Telegram HTML: <b>bold</b>, <i>italic</i>. No Markdown. Minimal emoji.
5. PROACTIVE: On "hi"/"hello" — greet by name and suggest something fitness-related.
6. WORKOUT PLAN: ${planRule}

TOOLS (use when needed):
- update_profile: when user wants to change age, gender, weight, height, fitness level, or goal.
- request_transition: when user explicitly wants to create a workout plan or start a session.

Respond with natural text only. Do NOT include JSON in your response.`;
}
