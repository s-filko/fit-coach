import { and, eq } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { exercises, sessionExercises, sessionSets, userAccounts, workoutSessions } from '@infra/db/schema';

import { createLogger } from '@shared/logger';

const log = createLogger('seed:workouts');

// Pass your Telegram ID as first arg, or use the default
const TELEGRAM_USER_ID = process.argv[2] ?? '353354751';

interface SetData {
  type: 'strength' | 'isometric';
  reps?: number;
  weight?: number;
  durationSeconds?: number;
}

interface ExerciseSeed {
  exerciseName: string;
  orderIndex: number;
  sets: SetData[];
}

interface WorkoutSeed {
  date: Date;
  durationMinutes: number;
  exercises: ExerciseSeed[];
}

const workoutSeeds: WorkoutSeed[] = [
  // --- 15 February: Back / Shoulders ---
  {
    date: new Date('2026-02-15T13:17:00'),
    durationMinutes: 92,
    exercises: [
      {
        exerciseName: 'Pull-ups',
        orderIndex: 0,
        sets: [
          { type: 'strength', reps: 9 },
          { type: 'strength', reps: 7 },
          { type: 'strength', reps: 4 },
        ],
      },
      {
        exerciseName: 'Chest-Supported Row, Narrow Grip',
        orderIndex: 1,
        sets: [
          { type: 'strength', reps: 10, weight: 20 },
          { type: 'strength', reps: 10, weight: 20 },
          { type: 'strength', reps: 10, weight: 17.5 },
          { type: 'strength', reps: 10, weight: 15 },
        ],
      },
      {
        exerciseName: 'Machine Shoulder Press',
        orderIndex: 2,
        sets: [
          { type: 'strength', reps: 10, weight: 27 },
          { type: 'strength', reps: 10, weight: 27 },
          { type: 'strength', reps: 9, weight: 27 },
          { type: 'strength', reps: 7, weight: 27 },
        ],
      },
      {
        exerciseName: 'Cable Seated Row, Close Grip',
        orderIndex: 3,
        sets: [
          { type: 'strength', reps: 10, weight: 36 },
          { type: 'strength', reps: 9, weight: 32 },
          { type: 'strength', reps: 10, weight: 27 },
          { type: 'strength', reps: 11, weight: 23 },
        ],
      },
      {
        exerciseName: 'Lateral Raise Machine',
        orderIndex: 4,
        sets: [
          { type: 'strength', reps: 10, weight: 0 },
          { type: 'strength', reps: 10, weight: 2.5 },
          { type: 'strength', reps: 10, weight: 5 },
          { type: 'strength', reps: 6, weight: 5 },
        ],
      },
      {
        exerciseName: 'Reverse Pec Deck Fly',
        orderIndex: 5,
        sets: [
          { type: 'strength', reps: 10, weight: 32 },
          { type: 'strength', reps: 7, weight: 32 },
          { type: 'strength', reps: 10, weight: 25 },
          { type: 'strength', reps: 11, weight: 18 },
        ],
      },
      {
        exerciseName: 'Dumbbell Shrugs',
        orderIndex: 6,
        sets: [
          { type: 'strength', reps: 12, weight: 22.5 },
          { type: 'strength', reps: 14, weight: 22.5 },
          { type: 'strength', reps: 12, weight: 22.5 },
          { type: 'strength', reps: 17, weight: 20 },
        ],
      },
      {
        exerciseName: 'Cable Pullover',
        orderIndex: 7,
        sets: [
          { type: 'strength', reps: 9, weight: 45 },
          { type: 'strength', reps: 10, weight: 38 },
          { type: 'strength', reps: 10, weight: 38 },
          { type: 'strength', reps: 10, weight: 32 },
        ],
      },
    ],
  },

  // --- 17 February: Chest / Triceps / Biceps / Core ---
  {
    date: new Date('2026-02-17T13:26:00'),
    durationMinutes: 88,
    exercises: [
      {
        exerciseName: 'Incline Machine Chest Press',
        orderIndex: 0,
        sets: [
          { type: 'strength', reps: 10, weight: 40 },
          { type: 'strength', reps: 8, weight: 50 },
          { type: 'strength', reps: 12, weight: 40 },
          { type: 'strength', reps: 10, weight: 40 },
        ],
      },
      {
        exerciseName: 'Pec Deck Fly',
        orderIndex: 1,
        sets: [
          { type: 'strength', reps: 10, weight: 45 },
          { type: 'strength', reps: 12, weight: 52 },
          { type: 'strength', reps: 13, weight: 52 },
          { type: 'strength', reps: 12, weight: 52 },
        ],
      },
      {
        exerciseName: 'Cable Tricep Pushdown, Straight Bar',
        orderIndex: 2,
        sets: [
          { type: 'strength', reps: 12, weight: 32 },
          { type: 'strength', reps: 10, weight: 45 },
          { type: 'strength', reps: 12, weight: 38 },
        ],
      },
      {
        exerciseName: 'Cable Overhead Tricep Extension',
        orderIndex: 3,
        sets: [
          { type: 'strength', reps: 7, weight: 36 },
          { type: 'strength', reps: 8, weight: 32 },
          { type: 'strength', reps: 10, weight: 25 },
        ],
      },
      {
        exerciseName: 'Hammer Strength Bicep Curl',
        orderIndex: 4,
        sets: [
          { type: 'strength', reps: 10, weight: 20 },
          { type: 'strength', reps: 10, weight: 20 },
          { type: 'strength', reps: 15, weight: 15 },
          { type: 'strength', reps: 13, weight: 15 },
        ],
      },
      {
        exerciseName: 'Cable Hammer Curl',
        orderIndex: 5,
        sets: [
          { type: 'strength', reps: 5, weight: 25 },
          { type: 'strength', reps: 10, weight: 18 },
          { type: 'strength', reps: 17, weight: 11 },
        ],
      },
      {
        exerciseName: 'Ab Coaster',
        orderIndex: 6,
        sets: [
          { type: 'strength', reps: 20 },
          { type: 'strength', reps: 20 },
          { type: 'strength', reps: 20 },
        ],
      },
      {
        exerciseName: 'Plank',
        orderIndex: 7,
        sets: [
          { type: 'isometric', durationSeconds: 35 },
          { type: 'isometric', durationSeconds: 40 },
          { type: 'isometric', durationSeconds: 40 },
          { type: 'isometric', durationSeconds: 40 },
        ],
      },
    ],
  },
];

async function findUser(telegramId: string): Promise<string> {
  const [account] = await db
    .select({ userId: userAccounts.userId })
    .from(userAccounts)
    .where(and(eq(userAccounts.provider, 'telegram'), eq(userAccounts.providerUserId, telegramId)));

  if (!account) {
    throw new Error(`User with Telegram ID ${telegramId} not found. Run the bot first to register.`);
  }

  return account.userId;
}

async function findExerciseId(name: string): Promise<string> {
  const [exercise] = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.name, name));

  if (!exercise) {
    throw new Error(`Exercise "${name}" not found. Run db:seed:exercises first.`);
  }

  return exercise.id;
}

export async function seedWorkouts() {
  const userId = await findUser(TELEGRAM_USER_ID);
  log.info({ userId, telegramId: TELEGRAM_USER_ID }, 'seeding workouts for user');

  for (const workout of workoutSeeds) {
    const dateStr = workout.date.toISOString().slice(0, 10);
    const completedAt = new Date(workout.date.getTime() + workout.durationMinutes * 60 * 1000);

    // Idempotency: skip if seed session for this date already exists
    const [existing] = await db
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.sessionKey, `seed_${dateStr}`)));

    if (existing) {
      log.info({ date: dateStr }, 'session already exists, skipping');
      continue;
    }

    const [session] = await db
      .insert(workoutSessions)
      .values({
        userId,
        status: 'completed',
        startedAt: workout.date,
        completedAt,
        durationMinutes: workout.durationMinutes,
        sessionKey: `seed_${dateStr}`,
        lastActivityAt: completedAt,
      })
      .returning();

    log.info({ date: dateStr, sessionId: session.id }, 'created session');

    for (const exSeed of workout.exercises) {
      const exerciseId = await findExerciseId(exSeed.exerciseName);

      const [sessionExercise] = await db
        .insert(sessionExercises)
        .values({
          sessionId: session.id,
          exerciseId,
          orderIndex: exSeed.orderIndex,
          status: 'completed',
          targetSets: exSeed.sets.length,
        })
        .returning();

      for (let i = 0; i < exSeed.sets.length; i++) {
        const set = exSeed.sets[i];
        await db.insert(sessionSets).values({
          sessionExerciseId: sessionExercise.id,
          setNumber: i + 1,
          setData: set as object,
          completedAt,
        });
      }

      log.debug({ exercise: exSeed.exerciseName, sets: exSeed.sets.length }, 'seeded exercise');
    }

    log.info({ date: dateStr, exercises: workout.exercises.length }, 'workout seeded');
  }

  log.info('all workouts seeded successfully');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seedWorkouts();
  process.exit(0);
}
