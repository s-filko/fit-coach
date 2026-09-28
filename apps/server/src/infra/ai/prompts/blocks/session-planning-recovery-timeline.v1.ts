/**
 * `session_planning.recovery_timeline` block (D-B) — moved verbatim from
 * `prompts/phases/session_planning/v1.ts`'s `buildRecoverySection` helper and
 * `recovery_timeline` section (P4 context-budget plan, Task 2). The `date`
 * section (Current Date + days-since-last-workout) stays in the phase prompt
 * per D-B — this block carries only the muscle-group recovery timeline.
 */
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { calendarDaysAgo, humanTimeAgo } from '@shared/date-utils';

import type { ContextBlock, ContextBlockCtx } from './types';

export function buildRecoverySection(sessions: WorkoutSessionWithDetails[], now: Date, tz?: string | null): string {
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

export interface SessionPlanningRecoveryTimelineData {
  recentSessions: WorkoutSessionWithDetails[];
}

export const SESSION_PLANNING_RECOVERY_TIMELINE_V1: ContextBlock<SessionPlanningRecoveryTimelineData> = {
  id: 'session_planning.recovery_timeline',
  version: 'v1',
  render(data, ctx: ContextBlockCtx) {
    const recoverySection = buildRecoverySection(data.recentSessions, ctx.now, ctx.user?.timezone);
    return `=== RECOVERY TIMELINE (muscle groups) ===\n\n${recoverySection}`;
  },
};
