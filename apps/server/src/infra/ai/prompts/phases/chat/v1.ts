import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { renderDirectives } from '@infra/ai/prompts/compose';
import { DEFAULT_DIRECTIVES_V1 } from '@infra/ai/prompts/directives';
import type { DirectiveContext, PromptModule, Section } from '@infra/ai/prompts/types';

import { humanTimeAgo } from '@shared/date-utils';

export interface ChatPromptContext extends DirectiveContext {
  hasActivePlan: boolean;
  recentSessions: WorkoutSessionWithDetails[];
}

const RULES_TEXT = `RULES:
1. SCOPE: Only discuss fitness, training, nutrition, health, wellness. Redirect anything else.
2. PERSONALIZATION: Consider the client profile when giving advice.
3. STYLE: Brief, motivating, conversational. Minimal emoji.
4. PROACTIVE: On "hi"/"hello" — greet and suggest something fitness-related.
5. WORKOUT PLAN: `;

const TOOLS_TEXT = `TOOLS (use when needed):
- update_profile: when user wants to change their name, age, gender, weight, height, fitness level, or goal.
- request_transition toPhase="plan_creation": when user explicitly wants to create a workout plan.
- request_transition toPhase="session_planning": when user wants to train today / start a session / plan a workout.
  ALWAYS use this tool — never describe workouts yourself from chat.
  ANTI-PATTERN: announcing a transition in text WITHOUT calling request_transition.
  Text alone does not trigger a transition — only the tool call does.
  Always call the tool; your text accompanies the call, not replaces it.`;

/** BUG-009 guard — the chat model must never claim it logged a set. */
const NO_SET_LOGGING_TEXT = `IMPORTANT: You do NOT have log_set or any set-logging capability. You CANNOT save workout sets.
NEVER write "✅", "logged", "saved", "recorded" about sets.
If the user reports a set, transition to training or tell them to start a session first.`;

/** Moved verbatim from graph/nodes/chat.node.ts (P2, AC-1321 — snapshot-arbitered). */
export const CHAT_V1: PromptModule<ChatPromptContext> = {
  id: 'phase.chat',
  version: 'v1',
  directives: DEFAULT_DIRECTIVES_V1,
  render(ctx: ChatPromptContext): Section[] {
    const { user, hasActivePlan, recentSessions } = ctx;

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
              const when = humanTimeAgo(new Date(date), ctx.now, user?.timezone);
              const exercises = s.exercises.map(ex => `${ex.exercise.name} (${ex.sets.length} sets)`).join(', ');
              return `- ${s.sessionKey ?? 'session'} — ${when}, ${s.durationMinutes ?? '?'} min: ${exercises || 'no exercises logged'}`;
            })
            .join('\n')
        : 'No recent sessions.';

    const clientName = user?.firstName ?? null;

    const planRule = hasActivePlan
      ? 'When the user wants to train/start a workout/plan today\'s session, IMMEDIATELY call request_transition({ toPhase: "session_planning" }). Do NOT give workout advice directly from chat.'
      : 'Suggest creating a workout plan if user wants to train. Call request_transition({ toPhase: "plan_creation" }) when user agrees.';

    const contextText = `CLIENT NAME: ${clientName ?? 'not provided'}
CLIENT PROFILE: ${profile || 'Not available'}
WORKOUT PLAN STATUS: ${planStatus}
RECENT TRAINING HISTORY (last 5 sessions):
${recentSessionsSection}`;

    return [
      { id: 'context', required: true, text: contextText },
      { id: 'rules', required: true, text: `${RULES_TEXT}${planRule}` },
      { id: 'tools', required: true, text: TOOLS_TEXT },
      { id: 'no_set_logging', required: true, text: NO_SET_LOGGING_TEXT },
      ...renderDirectives(DEFAULT_DIRECTIVES_V1, ctx),
    ];
  },
};
