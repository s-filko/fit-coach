/**
 * `chat.context` v2 (BUG-053, stale-session-autoclose plan T3 / AC-SSA_3): v1's render plus one
 * fact — a session closed by the timeout auto-close says so: `closed automatically after
 * inactivity` sits between the time and the duration on its recent-sessions line. A session
 * closed any other way, or one that was reopened and finished again (the reopen clears
 * `auto_close_reason`), shows no marker. Without a timeout-closed session the render is v1 byte
 * for byte. The only chat context block the chat phase renders.
 */
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { humanTimeAgo } from '@shared/date-utils';

import { buildChatContextText, CHAT_CONTEXT_V1, type ChatContextData } from './chat-context.v1';
import type { ContextBlock, ContextBlockCtx } from './types';

export function buildRecentSessionsSectionV2(
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
          const autoClosed = s.autoCloseReason === 'timeout' ? 'closed automatically after inactivity, ' : '';
          const exercises = s.exercises.map(ex => `${ex.exercise.name} (${ex.sets.length} sets)`).join(', ');
          return `- ${s.sessionKey ?? 'session'} — ${when}, ${autoClosed}${s.durationMinutes ?? '?'} min: ${
            exercises || 'no exercises logged'
          }`;
        })
        .join('\n')
    : 'No recent sessions.';
}

/** Depth 5 matches v1's fixed `recentSessions.slice(0, 5)` shape used by loadContext. */
export const CHAT_CONTEXT_V2: ContextBlock<ChatContextData> = {
  id: CHAT_CONTEXT_V1.id,
  version: 'v2',
  depths: [5, 3, 1],
  render(data, ctx, depth) {
    return buildChatContextText(data, ctx, depth, buildRecentSessionsSectionV2);
  },
};
