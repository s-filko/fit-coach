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

export const FIXTURE_SUMMARY = 'User trains 3x/week, prefers upper/lower split, reported mild shoulder discomfort.'

/** P4 Task 6: what compact's renderTranscript produces for the fixture episode (summariser v2 input). */
export const FIXTURE_TRANSCRIPT = [
  'User: Сегодня жим лёжа, 60 кг на 8',
  'Assistant: Записал: жим лёжа 60 кг × 8. Следующий подход — 62.5 кг.',
  'User: Плечо побаливает после последней тренировки',
  'Assistant: Понял. Снизим нагрузку на жим и добавим разминку плеча.',
].join('\n');

/** P4 Task 5: an episode summary derived from FIXTURE_SUMMARY's facts (D-C). */
export const FIXTURE_EPISODE_SUMMARY = {
  episodeId: '11111111-1111-4111-8111-111111111111',
  phaseAtEnd: 'training' as const,
  endedAt: '2026-09-16T18:00:00.000Z',
  summary: {
    topics: ['training plan discussed'],
    decisions: ['upper/lower split, 3 sessions per week'],
    userState: ['mild shoulder discomfort reported'],
    trainingFeedback: [],
    openItems: [],
  },
};;

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

/** Chat renders with a yesterday last-message so the greeting directive fires in L0. */
const CHAT_LAST_MESSAGE_TIME = new Date('2026-09-12T08:00:00.000Z');

/**
 * The fixture context for every module in the prompt registry, all at FIXED_NOW.
 * Unknown module ids throw — a registry entry without a fixture context is a bug.
 */
export function contextsForModule(moduleId: string, fixture: EvalFixture): unknown {
  const user = toUser(fixture);
  const base = {
    now: FIXED_NOW,
    timezone: user.timezone ?? null,
    client: 'telegram' as const,
    user,
    lastMessageTime: null,
  };

  switch (moduleId) {
    case 'phase.registration':
    case 'phase.plan_creation':
      return base;
    case 'phase.chat':
      return {
        ...base,
        lastMessageTime: CHAT_LAST_MESSAGE_TIME,
        hasActivePlan: fixture.hasActivePlan ?? false,
        recentSessions: [],
      };
    case 'phase.session_planning':
      return { ...base, context: buildSessionPlanningContext(fixture, FIXED_NOW) };
    case 'phase.training':
      return { ...base, session: buildFixtureSession(fixture, FIXED_NOW), previousSession: null };
    case 'summarizer':
      return { phase: 'training', transcript: FIXTURE_TRANSCRIPT };
    case 'block.episode_summaries':
      return { summaries: [FIXTURE_EPISODE_SUMMARY], now: FIXED_NOW, timezone: 'Europe/Berlin' };
    case 'block.post_tool_nudge':
      return {};
    default:
      throw new Error(`No fixture context wired for prompt module ${moduleId}`);
  }
}
