/**
 * The smoke scenario's world, seed-only (smoke-test plan, Task 3 / AC-SM-3):
 * no model, no graph — just `ScenarioSchema.parse` and the REAL rows
 * `seedScenarioRows` writes for `evals/scenarios/smoke.scenario.ts`. The live
 * run itself (`npm run smoke`) is the orchestrator's job (Task 4).
 */
import { asc, eq, inArray } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { exerciseMuscleGroups, exercises, sessionExercises, workoutSessions } from '@infra/db/schema';

import { seedScenarioRows } from '../../../evals/lib/scenario-world';
import { ScenarioSchema } from '../../../evals/schema/scenario.schema';
import { past, scenario } from '../../../evals/scenarios/smoke.scenario';

let world: Awaited<ReturnType<typeof seedScenarioRows>>;

beforeAll(async () => {
  world = await seedScenarioRows(past, new Date());
});

describe('smoke scenario — format and seeded world (AC-SM-3)', () => {
  it('parses against ScenarioSchema', () => {
    expect(ScenarioSchema.parse(scenario)).toBeTruthy();
  });

  it('is registered under its own id and no other scenario shares it', () => {
    expect(scenario.id).toBe('smoke');
  });

  it('seeds the catalog exercises with their muscle rows', async () => {
    const names = past.catalog!.map(c => c.name);
    const rows = await db
      .select({ id: exercises.id, name: exercises.name })
      .from(exercises)
      .where(inArray(exercises.name, names));
    expect(rows).toHaveLength(names.length);

    const muscleRows = await db
      .select({ exerciseId: exerciseMuscleGroups.exerciseId })
      .from(exerciseMuscleGroups)
      .where(
        inArray(
          exerciseMuscleGroups.exerciseId,
          rows.map(r => r.id),
        ),
      );
    // Every catalog exercise declares at least one muscle (CatalogExerciseSchema.muscles.min(1)).
    const exercisesWithMuscles = new Set(muscleRows.map(r => r.exerciseId));
    for (const row of rows) {
      expect(exercisesWithMuscles.has(row.id)).toBe(true);
    }
  });

  it('seeds the completed-but-empty session (BUG-031) as the most recent one before T0', async () => {
    const sessions = await db
      .select({
        id: workoutSessions.id,
        status: workoutSessions.status,
        completedAt: workoutSessions.completedAt,
        startedAt: workoutSessions.startedAt,
      })
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, world.userId))
      .orderBy(asc(workoutSessions.startedAt));

    expect(sessions).toHaveLength(past.workouts!.length);
    const lastSession = sessions[sessions.length - 1]!;
    expect(lastSession.status).toBe('completed');
    expect(lastSession.completedAt).not.toBeNull();

    const exerciseRows = await db
      .select({ id: sessionExercises.id })
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, lastSession.id));
    expect(exerciseRows).toHaveLength(0);
  });

  it('seeds every workout as completed — the empty session is completed-but-empty, not skipped', async () => {
    const rows = await db
      .select({ status: workoutSessions.status })
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, world.userId));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status).toBe('completed');
    }
  });

  it("gives every HISTORY workout a hist_ key, never the plan's own session keys (fix for the first live run)", async () => {
    const rows = await db
      .select({ sessionKey: workoutSessions.sessionKey })
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, world.userId));
    expect(rows.length).toBe(past.workouts!.length);
    for (const row of rows) {
      expect(row.sessionKey).toMatch(/^hist_\d{8}_(upper|lower|cardio)$/);
      // The plan's own keys ('upper_a'/'lower_a') must stay free for the LIVE
      // session the scripted steps create — the first live run's
      // persisted.session checks hit the seeded empty session instead of the
      // new one because both shared 'upper_a'.
      expect(row.sessionKey).not.toBe('upper_a');
      expect(row.sessionKey).not.toBe('lower_a');
    }
  });
});
