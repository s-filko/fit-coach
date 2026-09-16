import type { SessionPlanningContextData } from '@domain/training/services/session-planning-context.builder';
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import type { User } from '@domain/user/services/user.service';

import type { EvalFixture } from '../schema/case.schema';

/** One clock for every rendered fixture — relative-time phrasing must be stable. */
export const FIXED_NOW = new Date('2026-09-13T10:00:00.000Z');

/** BR-EVAL-003: hand-written, no real user data. */
export const FIXTURE_HISTORY: Array<{ role: 'user' | 'assistant'; content: string }> = [
  { role: 'user', content: 'Сегодня жим лёжа, 60 кг на 8' },
  { role: 'assistant', content: 'Записал: жим лёжа 60 кг × 8. Следующий подход — 62.5 кг.' },
];

export const FIXTURE_SUMMARY = 'User trains 3x/week, prefers upper/lower split, reported mild shoulder discomfort.';

export const FIXTURE_TOOL_RESULTS: Array<{ ok: boolean; content: string }> = [
  { ok: true, content: 'Set 2 logged: 60 kg × 8 (RPE 7)' },
  { ok: false, content: 'exercise id not found in session' },
];

export function toUser(fixture: EvalFixture): User {
  const { registrationCompleted, ...profile } = fixture.user;
  return {
    id: 'eval-user-1',
    profileStatus: registrationCompleted === true ? 'complete' : 'collecting',
    ...profile,
  };
}

export function buildFixtureSession(fixture: EvalFixture, now: Date): WorkoutSessionWithDetails {
  const active = fixture.activeSession as { id?: string; sessionKey?: string } | undefined;
  return {
    id: active?.id ?? 'eval-session-1',
    userId: 'eval-user-1',
    planId: 'eval-plan-1',
    sessionKey: active?.sessionKey ?? 'Upper A',
    status: 'in_progress',
    startedAt: now,
    completedAt: null,
    durationMinutes: null,
    userContextJson: null,
    sessionPlanJson: null,
    lastActivityAt: now,
    autoCloseReason: null,
    createdAt: now,
    updatedAt: now,
    exercises: [],
  };
}

export function buildSessionPlanningContext(fixture: EvalFixture, now: Date): SessionPlanningContextData {
  return {
    activePlan: null,
    recentSessions: fixture.activeSession ? [buildFixtureSession(fixture, now)] : [],
    daysSinceLastWorkout: fixture.activeSession ? 0 : null,
  };
}
