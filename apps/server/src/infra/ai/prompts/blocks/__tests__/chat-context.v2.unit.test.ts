/**
 * `chat.context` v2 (BUG-053, stale-session-autoclose plan T3 / AC-SSA-3): the recent-sessions
 * list states the fact that a workout was closed automatically — `closed automatically after
 * inactivity` on a `auto_close_reason = 'timeout'` line, nothing on any other (a reopened
 * session that finished again carries no auto-close reason, so it shows no marker). Facts only;
 * without a timeout-closed session the render is v1 byte for byte.
 */
import type { WorkoutSessionWithDetails } from '@domain/training/types';

import { buildRecentSessionsSection, CHAT_CONTEXT_V1 } from '../chat-context.v1';
import { CHAT_CONTEXT_V2 } from '../chat-context.v2';
import type { ContextBlockCtx } from '../types';

const ctx: ContextBlockCtx = {
  now: new Date('2026-10-08T18:00:00.000Z'),
  timezone: 'Europe/Berlin',
  user: { timezone: 'Europe/Berlin' },
} as unknown as ContextBlockCtx;

/** One completed upper_a with `autoCloseReason` as given. */
const sessionWith = (autoCloseReason: WorkoutSessionWithDetails['autoCloseReason']): WorkoutSessionWithDetails =>
  ({
    id: 's-1',
    userId: 'u1',
    planId: null,
    sessionKey: 'upper_a',
    status: 'completed',
    place: null,
    startedAt: new Date('2026-10-08T09:54:00.000Z'),
    completedAt: new Date('2026-10-08T11:31:00.000Z'),
    durationMinutes: 97,
    userContextJson: null,
    sessionPlanJson: null,
    lastActivityAt: new Date('2026-10-08T11:31:00.000Z'),
    autoCloseReason,
    reopenedAt: null,
    createdAt: new Date('2026-10-08T09:54:00.000Z'),
    updatedAt: new Date('2026-10-08T11:31:00.000Z'),
    exercises: [
      {
        id: 'se-1',
        sessionId: 's-1',
        exerciseId: 'ex-1',
        orderIndex: 0,
        status: 'completed',
        targetSets: 3,
        targetReps: '8-10',
        targetWeight: null,
        actualRepsRange: null,
        userFeedback: null,
        createdAt: new Date(),
        exercise: {
          id: 'ex-1',
          name: 'Barbell Bench Press',
          category: 'compound',
          equipment: 'barbell',
          exerciseType: 'strength',
          description: null,
          energyCost: 'high',
          complexity: 'intermediate',
          typicalDurationMinutes: 15,
          requiresSpotter: false,
          imageUrl: null,
          videoUrl: null,
          createdAt: new Date(),
          muscleGroups: [],
        },
        sets: [
          {
            id: 'set-1',
            sessionExerciseId: 'se-1',
            setNumber: 1,
            rpe: null,
            userFeedback: null,
            createdAt: new Date(),
            completedAt: null,
            setData: { type: 'strength', reps: 8, weight: 80, weightUnit: 'kg' },
          },
        ],
      },
    ],
  }) as WorkoutSessionWithDetails;

const dataOf = (sessions: WorkoutSessionWithDetails[]) => ({ hasActivePlan: true, recentSessions: sessions });

describe('chat.context v2 — the auto-close fact (BUG-053 T3, AC-SSA-3)', () => {
  it("a timeout-closed session's line carries 'closed automatically after inactivity' between the time and the duration", () => {
    const text = CHAT_CONTEXT_V2.render(dataOf([sessionWith('timeout')]), ctx, 5);

    expect(text).toMatch(/- upper_a — [^,\n]+, closed automatically after inactivity, 97 min:/);
    expect(text).toContain('Barbell Bench Press (1 sets)');
  });

  it('a session closed any other way (manual, new_session_started) shows no marker', () => {
    for (const reason of ['manual', 'new_session_started'] as const) {
      const text = CHAT_CONTEXT_V2.render(dataOf([sessionWith(reason)]), ctx, 5);
      expect(text).not.toContain('closed automatically');
    }
  });

  it('a reopened-then-finished session (no auto_close_reason) shows no marker', () => {
    const text = CHAT_CONTEXT_V2.render(dataOf([sessionWith(null)]), ctx, 5);
    expect(text).not.toContain('closed automatically');
  });

  it('without a timeout-closed session the render is byte-identical to v1', () => {
    const sessions = [sessionWith(null), sessionWith('manual')];
    expect(CHAT_CONTEXT_V2.render(dataOf(sessions), ctx, 5)).toBe(CHAT_CONTEXT_V1.render(dataOf(sessions), ctx, 5));
  });

  it('the marker sits on the section line itself (v1’s shared builder with markAutoClosed)', () => {
    const section = buildRecentSessionsSection([sessionWith('timeout')], ctx, 5, { markAutoClosed: true });
    expect(section).toMatch(/- upper_a — [^,\n]+, closed automatically after inactivity, 97 min:/);
    expect(buildRecentSessionsSection([sessionWith('timeout')], ctx, 5)).not.toContain('closed automatically');
  });

  it('same block id as v1, version bumped (BR-LLM-008)', () => {
    expect(CHAT_CONTEXT_V2.id).toBe(CHAT_CONTEXT_V1.id);
    expect(CHAT_CONTEXT_V2.version).toBe('v2');
    expect(CHAT_CONTEXT_V1.version).toBe('v1');
  });
});
