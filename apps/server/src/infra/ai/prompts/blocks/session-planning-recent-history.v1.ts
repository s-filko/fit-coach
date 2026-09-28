/**
 * `session_planning.recent_history` block (D-B) — moved verbatim from
 * `prompts/phases/session_planning/v1.ts`'s `buildHistorySection` helper and
 * `recent_history` section (P4 context-budget plan, Task 2).
 *
 * Depth steps the session count: 5 (v1's fixed depth, context builder already
 * limits recentSessions upstream) -> 3 -> 1.
 */
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { humanTimeAgo } from '@shared/date-utils';

import type { ContextBlock, ContextBlockCtx } from './types';

export function buildHistorySection(sessions: WorkoutSessionWithDetails[], now: Date, tz?: string | null): string {
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

export interface SessionPlanningRecentHistoryData {
  recentSessions: WorkoutSessionWithDetails[];
}

export const SESSION_PLANNING_RECENT_HISTORY_V1: ContextBlock<SessionPlanningRecentHistoryData> = {
  id: 'session_planning.recent_history',
  version: 'v1',
  depths: [5, 3, 1],
  render(data, ctx: ContextBlockCtx, depth) {
    const sessions = data.recentSessions.slice(0, depth);
    const historySection = buildHistorySection(sessions, ctx.now, ctx.user?.timezone);
    return `=== RECENT TRAINING HISTORY (last sessions) ===\n\n${historySection}`;
  },
};
