/**
 * Shared seeding helpers for the scenario repro tests (coach-baseline Tasks 2–3): direct inserts
 * into workout_sessions with explicit dates, and the "states the date" matcher. Nothing here is
 * relative to the wall clock — callers pin NOW themselves.
 */
import { db } from '@infra/db/drizzle';
import { workoutSessions } from '@infra/db/schema';

import type { SessionExerciseRepository } from '@infra/db/repositories/session-exercise.repository';
import type { SessionSetRepository } from '@infra/db/repositories/session-set.repository';

export interface SeedSession {
  key: string;
  date: string;
  exercises: Array<{ name: string; sets: Array<{ reps: number; weight: number }> }>;
}

/** ISO, DD.MM.YYYY, "Sep 16" and "16 Sep(tember)" all count as "states the date". */
export function datePattern(isoDate: string): RegExp {
  const [y, m, d] = isoDate.split('-').map(Number);
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const mon = month.slice(0, 3);
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return new RegExp(`${isoDate}|${dd}\\.${mm}\\.${y}|${mon}[a-z]* 0?${d}\\b|\\b0?${d} ${mon}`, 'i');
}

export type SessionSeeder = (
  status: 'completed' | 'in_progress',
  s: { key: string; date: string; exercises?: SeedSession['exercises'] },
) => Promise<string>;

/**
 * Seeds one workout_sessions row (started at date T12:00Z, completed +1h when completed) with its
 * session_exercises and sets; exercises are resolved through the caller's name→id map. Returns the
 * session id.
 */
export function createSessionSeeder(repos: {
  userId: string;
  exerciseIds: Map<string, string>;
  sessionExerciseRepo: SessionExerciseRepository;
  sessionSetRepo: SessionSetRepository;
}): SessionSeeder {
  return async (status, s) => {
    const at = new Date(`${s.date}T12:00:00.000Z`);
    const [row] = await db
      .insert(workoutSessions)
      .values({
        userId: repos.userId,
        sessionKey: s.key,
        status,
        startedAt: at,
        completedAt: status === 'completed' ? new Date(at.getTime() + 60 * 60 * 1000) : null,
        lastActivityAt: at,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    for (const [i, ex] of (s.exercises ?? []).entries()) {
      const se = await repos.sessionExerciseRepo.create(row.id, {
        exerciseId: repos.exerciseIds.get(ex.name)!,
        orderIndex: i,
      });
      for (const set of ex.sets) {
        await repos.sessionSetRepo.create(se.id, {
          setData: { type: 'strength', reps: set.reps, weight: set.weight, weightUnit: 'kg' },
          createdAt: at,
        });
      }
    }
    return row.id;
  };
}
