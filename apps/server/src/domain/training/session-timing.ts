import type { SessionSet } from './types';

/** A training session idle longer than this is stale: retro-logging territory, or an auto-close candidate. */
export const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Retro-logged sets are offset from the last real activity by this much. */
export const RETRO_SET_OFFSET_MS = 5 * 60 * 1000;

interface TimedSession {
  lastActivityAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt: Date | string;
  exercises: ReadonlyArray<{ sets: ReadonlyArray<Pick<SessionSet, 'id'>> }>;
}

/** The session's last activity moment: `lastActivityAt`, falling back to `updatedAt` / `createdAt`. */
export function lastActivityOf(session: Pick<TimedSession, 'lastActivityAt' | 'updatedAt' | 'createdAt'>): Date {
  return new Date(session.lastActivityAt ?? session.updatedAt ?? session.createdAt);
}

export function hasLoggedSets(session: Pick<TimedSession, 'exercises'>): boolean {
  return session.exercises.some(ex => ex.sets.length > 0);
}

/**
 * BUG-043: a set is retro-logged (catch-up on a workout that already happened) only when the session
 * has been idle past the timeout AND already holds sets. A session with no sets never began — the
 * first set after a long gap is a late start, so it is live.
 */
export function isRetroLog(session: TimedSession, now: Date): boolean {
  return now.getTime() - lastActivityOf(session).getTime() > SESSION_TIMEOUT_MS && hasLoggedSets(session);
}

/** A session with no sets that has been idle past the timeout: its first set is a late start. */
export function isLateStart(session: TimedSession, now: Date): boolean {
  return now.getTime() - lastActivityOf(session).getTime() > SESSION_TIMEOUT_MS && !hasLoggedSets(session);
}

/** Completion never precedes the start; duration is whole minutes and never negative. */
export function resolveCompletion(
  startedAt: Date | null,
  completedAt: Date,
): { completedAt: Date; durationMinutes: number | null } {
  const clamped = startedAt && completedAt < startedAt ? startedAt : completedAt;
  return {
    completedAt: clamped,
    durationMinutes: startedAt ? Math.max(0, Math.floor((clamped.getTime() - startedAt.getTime()) / 60000)) : null,
  };
}
