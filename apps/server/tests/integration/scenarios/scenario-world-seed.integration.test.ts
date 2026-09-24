/**
 * Seed realism (smoke-test plan, Task 1 / AC-SM-1): `past.catalog` and its
 * muscle rows, workout `status` (skipped / completed-but-empty), and
 * duration/distance sets — proven by asserting the REAL rows `seedScenarioRows`
 * writes to the test database, no model, no graph.
 */
import { asc, eq, inArray } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { exerciseMuscleGroups, exercises, sessionExercises, sessionSets, workoutSessions } from '@infra/db/schema';

import { seedScenarioRows } from '../../../evals/lib/scenario-world';
import type { Scenario } from '../../../evals/schema/scenario.schema';

const T0 = new Date('2026-09-20T10:00:00.000Z');

const past: Scenario['past'] = {
  user: {
    languageCode: 'ru',
    timezone: 'Europe/Berlin',
    firstName: 'Alex',
    age: 30,
    gender: 'male',
    height: 180,
    weight: 80,
    fitnessLevel: 'intermediate',
    fitnessGoal: 'strength',
    registrationCompleted: true,
  },
  catalog: [
    {
      name: 'Plank',
      exerciseType: 'isometric',
      category: 'functional',
      muscles: [
        { group: 'core', involvement: 'primary' },
        { group: 'abs', involvement: 'secondary' },
      ],
    },
    {
      name: 'Treadmill Run',
      exerciseType: 'cardio_distance',
      category: 'cardio',
      muscles: [{ group: 'cardio_system', involvement: 'primary' }],
    },
  ],
  workouts: [
    {
      at: '-10d',
      key: 'upper_a',
      status: 'skipped',
      exercises: [],
    },
    {
      at: '-7d',
      key: 'lower_a',
      status: 'completed',
      exercises: [],
    },
    {
      at: '-3d',
      key: 'upper_a',
      status: 'completed',
      exercises: [
        {
          exercise: 'Plank',
          sets: [{ durationSeconds: 60 }],
        },
        {
          exercise: 'Treadmill Run',
          sets: [{ distanceMeters: 3000, durationSeconds: 900 }],
        },
      ],
    },
  ],
  facts: [],
};

let world: Awaited<ReturnType<typeof seedScenarioRows>>;

beforeAll(async () => {
  world = await seedScenarioRows(past, T0);
});

describe('scenario world seeding — catalog, workout status, duration/distance sets', () => {
  it('inserts the catalog exercises with their muscle rows', async () => {
    const rows = await db
      .select({
        id: exercises.id,
        name: exercises.name,
        exerciseType: exercises.exerciseType,
        category: exercises.category,
      })
      .from(exercises)
      .where(inArray(exercises.name, ['Plank', 'Treadmill Run']));

    expect(rows).toHaveLength(2);
    const plank = rows.find(r => r.name === 'Plank')!;
    const run = rows.find(r => r.name === 'Treadmill Run')!;
    expect(plank.exerciseType).toBe('isometric');
    expect(plank.category).toBe('functional');
    expect(run.exerciseType).toBe('cardio_distance');
    expect(run.category).toBe('cardio');

    const muscleRows = await db
      .select({
        exerciseId: exerciseMuscleGroups.exerciseId,
        muscleGroup: exerciseMuscleGroups.muscleGroup,
        involvement: exerciseMuscleGroups.involvement,
      })
      .from(exerciseMuscleGroups)
      .where(inArray(exerciseMuscleGroups.exerciseId, [plank.id, run.id]));

    const plankMuscles = muscleRows.filter(m => m.exerciseId === plank.id);
    expect(plankMuscles).toHaveLength(2);
    expect(plankMuscles).toEqual(
      expect.arrayContaining([
        { exerciseId: plank.id, muscleGroup: 'core', involvement: 'primary' },
        { exerciseId: plank.id, muscleGroup: 'abs', involvement: 'secondary' },
      ]),
    );

    const runMuscles = muscleRows.filter(m => m.exerciseId === run.id);
    expect(runMuscles).toEqual([{ exerciseId: run.id, muscleGroup: 'cardio_system', involvement: 'primary' }]);
  });

  it('seeds a skipped workout with no completedAt', async () => {
    const [session] = await db
      .select({ status: workoutSessions.status, completedAt: workoutSessions.completedAt })
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, world.userId))
      .orderBy(asc(workoutSessions.startedAt))
      .limit(1);

    expect(session?.status).toBe('skipped');
    expect(session?.completedAt).toBeNull();
  });

  it('seeds a completed-but-empty workout (exercises: [])', async () => {
    const rows = await db
      .select({ id: workoutSessions.id, status: workoutSessions.status, completedAt: workoutSessions.completedAt })
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, world.userId))
      .orderBy(asc(workoutSessions.startedAt));

    const empty = rows[1]!;
    expect(empty.status).toBe('completed');
    expect(empty.completedAt).not.toBeNull();

    const sessionExerciseRows = await db
      .select({ id: sessionExercises.id })
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, empty.id));
    expect(sessionExerciseRows).toHaveLength(0);
  });

  it('maps a duration set onto the exercise-type-appropriate setData variant', async () => {
    const [plankExercise] = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.name, 'Plank'));

    const [sessionExercise] = await db
      .select({ id: sessionExercises.id })
      .from(sessionExercises)
      .where(eq(sessionExercises.exerciseId, plankExercise!.id));

    const sets = await db
      .select({ setData: sessionSets.setData })
      .from(sessionSets)
      .where(eq(sessionSets.sessionExerciseId, sessionExercise!.id));

    expect(sets).toHaveLength(1);
    expect(sets[0]!.setData).toMatchObject({ type: 'isometric', duration: 60 });
  });

  it('maps a distance set onto the cardio_distance setData variant', async () => {
    const [runExercise] = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(eq(exercises.name, 'Treadmill Run'));

    const [sessionExercise] = await db
      .select({ id: sessionExercises.id })
      .from(sessionExercises)
      .where(eq(sessionExercises.exerciseId, runExercise!.id));

    const sets = await db
      .select({ setData: sessionSets.setData })
      .from(sessionSets)
      .where(eq(sessionSets.sessionExerciseId, sessionExercise!.id));

    expect(sets).toHaveLength(1);
    expect(sets[0]!.setData).toMatchObject({
      type: 'cardio_distance',
      distance: 3000,
      distanceUnit: 'meters',
      duration: 900,
    });
  });

  it('leaves existing scenario modules parsing and seeding unchanged (no catalog)', async () => {
    const legacyPast: Scenario['past'] = {
      user: past.user,
      catalog: [],
      workouts: [
        {
          at: '-1d',
          key: 'legacy_a',
          status: 'completed',
          exercises: [{ exercise: 'Barbell Bench Press', sets: [{ reps: 8, weight: 80 }] }],
        },
      ],
      facts: [],
    };
    const legacyWorld = await seedScenarioRows(legacyPast, T0);
    const rows = await db
      .select({ status: workoutSessions.status, completedAt: workoutSessions.completedAt })
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, legacyWorld.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('completed');
    expect(rows[0]?.completedAt).not.toBeNull();
  });
});
