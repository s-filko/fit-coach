/**
 * `chat.context` block (D-B) — moved verbatim from `prompts/phases/chat/v1.ts`'s
 * `context` section (P4 context-budget plan, Task 2). Renders byte-identical
 * to what v1 rendered for the section id `context` (proof: __tests__/chat-context.v1.unit.test.ts
 * against V1.render over the L0 fixtures).
 *
 * Depth steps the RECENT TRAINING HISTORY list: 5 (v1's fixed depth) -> 3 -> 1.
 */
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { humanTimeAgo } from '@shared/date-utils';

import type { ContextBlock, ContextBlockCtx } from './types';

export interface ChatContextData {
  hasActivePlan: boolean;
  recentSessions: WorkoutSessionWithDetails[];
}

export function buildRecentSessionsSection(
  recentSessions: WorkoutSessionWithDetails[],
  ctx: ContextBlockCtx,
  depth: number,
): string {
  const sessions = recentSessions.slice(0, depth);
  return sessions.length > 0
    ? sessions
        .map(s => {
          const date = s.completedAt ?? s.startedAt ?? s.createdAt;
          const when = humanTimeAgo(new Date(date), ctx.now, ctx.user?.timezone);
          const exercises = s.exercises.map(ex => `${ex.exercise.name} (${ex.sets.length} sets)`).join(', ');
          return `- ${s.sessionKey ?? 'session'} — ${when}, ${s.durationMinutes ?? '?'} min: ${exercises || 'no exercises logged'}`;
        })
        .join('\n')
    : 'No recent sessions.';
}

export function buildChatContextText(data: ChatContextData, ctx: ContextBlockCtx, depth: number): string {
  const { user } = ctx;
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

  const planStatus = data.hasActivePlan
    ? 'User HAS an active workout plan. They can start planning workout sessions.'
    : 'User DOES NOT have a workout plan yet. Suggest creating one when appropriate.';

  const recentSessionsSection = buildRecentSessionsSection(data.recentSessions, ctx, depth);

  const clientName = user?.firstName ?? null;

  return `CLIENT NAME: ${clientName ?? 'not provided'}
CLIENT PROFILE: ${profile || 'Not available'}
WORKOUT PLAN STATUS: ${planStatus}
RECENT TRAINING HISTORY (last 5 sessions):
${recentSessionsSection}`;
}

/** Depth 5 matches v1's fixed `recentSessions.slice(0, 5)` shape used by loadContext. */
export const CHAT_CONTEXT_V1: ContextBlock<ChatContextData> = {
  id: 'chat.context',
  version: 'v1',
  depths: [5, 3, 1],
  render(data, ctx, depth) {
    return buildChatContextText(data, ctx, depth);
  },
};
