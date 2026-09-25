/**
 * Scenario world seeding (training-journey-scenarios plan, Task 2 / AC-TJ-2):
 * turns a scenario's `past` into REAL rows in the test database — user, extra
 * exercises (`ON CONFLICT` on the catalog), an active plan, dated workouts with
 * exercises and sets, and durable facts through the real `UserFactsRepository`
 * — plus the durable conversation checkpoint (`graph.updateState`: messages,
 * episode summaries, `lastUserMessageAt`).
 *
 * Every dated row carries an explicit timestamp resolved from T0: history is
 * ordered by `createdAt` (`findRecentByUserIdWithDetails`), so a seed without
 * one lands at "now" and every age-based assertion goes wrong.
 */
import { randomUUID } from 'node:crypto';

import { inArray } from 'drizzle-orm';

import type { StoredEpisodeSummary } from '@domain/conversation/episode';
import type { IEmbeddingService } from '@domain/training/ports';
import type { CompiledConversationGraph } from '@infra/ai/graph/conversation.graph';
import { UserFactsRepository } from '@infra/db/repositories/user-facts.repository';
import { db } from '@infra/db/drizzle';
import {
  exerciseMuscleGroups,
  exercises,
  sessionExercises,
  sessionSets,
  users,
  workoutPlans,
  workoutSessions,
} from '@infra/db/schema';
import { embedPendingExercises } from '@infra/db/seeds/embed-pending-exercises';
import type { ExerciseType, WorkoutPlanJson } from '@domain/training/types';

import { bindSeedMessages } from '../schema/case.schema';
import { resolveRelativeTime, type CatalogExercise, type Scenario, type WorkoutSet } from '../schema/scenario.schema';

import { toBaseMessages } from './seed-messages';

export interface SeededScenarioWorld {
  userId: string;
  planId: string | null;
}

/** Fixed duration for a seeded workout (the format has no per-workout field). */
const SEEDED_WORKOUT_MINUTES = 60;

/** Every exercise name a scenario references (plan sessions + past workouts). */
function exerciseNamesOf(past: Scenario['past']): string[] {
  const names = new Set<string>();
  for (const session of past.plan?.sessions ?? []) {
    for (const ex of session.exercises) {
      names.add(ex.exercise);
    }
  }
  for (const workout of past.workouts) {
    for (const ex of workout.exercises) {
      names.add(ex.exercise);
    }
  }
  return [...names];
}

/** An exercise's resolved id plus the type its seeded sets must map onto. */
export interface ResolvedExercise {
  id: string;
  exerciseType: ExerciseType;
}

/**
 * Resolves exercise names to ids. A name in `catalog` is seeded with its real
 * exercise type/category and muscle rows (`exercise_muscle_groups`, AC-SM-1);
 * anything else (including the test setup's four) keeps today's generic
 * strength fallback. `ON CONFLICT (name) DO NOTHING` keeps a repeat run
 * idempotent within one schema lifetime.
 *
 * Also embeds any of these exercises still missing one, IF an
 * `embeddingService` is given (close-out review correction, 2026-09-25): a
 * scenario-seeded exercise had no embedding, so `search_exercises` (which
 * filters `embedding IS NOT NULL`) silently found nothing for it —
 * misdiagnosed as BUG-033 ("Russian names not found") until the orchestrator
 * checked `select count(embedding) from exercises` on the local test DB.
 * Left undefined (every Jest scenario test), no embedding is computed at all
 * — the real ONNX pipeline crashes inside Jest's runtime in this environment
 * (see `embed-pending-exercises.ts`'s header). Only the live L3 CLI path
 * passes one, the same `embedPendingExercises`
 * (`@infra/db/seeds/embed-pending-exercises.ts`) `seed-embeddings.ts`'s
 * production catalog backfill script uses.
 */
async function resolveExerciseIds(
  names: string[],
  catalog: CatalogExercise[],
  embeddingService?: IEmbeddingService,
): Promise<Map<string, ResolvedExercise>> {
  const catalogByName = new Map(catalog.map(entry => [entry.name, entry]));

  for (const name of names) {
    const entry = catalogByName.get(name);
    await db
      .insert(exercises)
      .values({
        id: randomUUID(),
        name,
        category: entry?.category ?? 'compound',
        equipment: entry ? 'none' : 'barbell',
        exerciseType: entry?.exerciseType ?? 'strength',
        description: 'Scenario seed exercise',
        energyCost: 'medium',
        complexity: 'intermediate',
        typicalDurationMinutes: 12,
        requiresSpotter: false,
      })
      .onConflictDoNothing({ target: exercises.name });
  }
  const rows = await db
    .select({ id: exercises.id, name: exercises.name, exerciseType: exercises.exerciseType })
    .from(exercises)
    .where(inArray(exercises.name, names));

  const resolved = new Map<string, ResolvedExercise>();
  for (const row of rows) {
    resolved.set(row.name, { id: row.id, exerciseType: row.exerciseType });
    const entry = catalogByName.get(row.name);
    if (!entry) {
      continue;
    }
    for (const muscle of entry.muscles) {
      await db
        .insert(exerciseMuscleGroups)
        .values({ exerciseId: row.id, muscleGroup: muscle.group, involvement: muscle.involvement })
        .onConflictDoNothing();
    }
  }

  if (embeddingService) {
    await embedPendingExercises(embeddingService, names);
  }

  return resolved;
}

/**
 * Maps a seeded `WorkoutSet` onto the real `setData` shape
 * (`src/domain/training/set-data.types.ts`). Which variant it is follows
 * from which keys are present, not a literal tag — `distanceMeters` means
 * `cardio_distance`; a lone `durationSeconds` means `cardio_duration` when
 * the exercise IS that type, `isometric` otherwise (a plank, the common
 * case); anything else is today's strength shape.
 */
function toSetData(set: WorkoutSet, exerciseType: ExerciseType): Record<string, unknown> {
  if ('distanceMeters' in set) {
    return {
      type: 'cardio_distance',
      distance: set.distanceMeters,
      distanceUnit: 'meters',
      duration: set.durationSeconds ?? 0,
    };
  }
  if ('durationSeconds' in set) {
    return {
      type: exerciseType === 'cardio_duration' ? 'cardio_duration' : 'isometric',
      duration: set.durationSeconds,
    };
  }
  return {
    type: 'strength',
    reps: set.reps,
    ...(set.weight !== undefined ? { weight: set.weight } : {}),
  };
}

/** Builds the `planJson` the `save_workout_plan` tool would have written. */
function toPlanJson(past: Scenario['past'], exerciseIds: Map<string, ResolvedExercise>): WorkoutPlanJson {
  return {
    goal: 'General fitness',
    trainingStyle: 'balanced strength training',
    targetMuscleGroups: [],
    recoveryGuidelines: {
      majorMuscleGroups: { minRestDays: 2, maxRestDays: 3 },
      smallMuscleGroups: { minRestDays: 1, maxRestDays: 2 },
      highIntensity: { minRestDays: 3 },
      customRules: [],
    },
    progressionRules: [],
    sessionTemplates: (past.plan?.sessions ?? []).map(session => ({
      key: session.key,
      name: session.title ?? session.key,
      focus: session.title ?? session.key,
      energyCost: 'high',
      estimatedDuration: 60,
      exercises: session.exercises.map(ex => ({
        exerciseId: exerciseIds.get(ex.exercise)!.id,
        exerciseName: ex.exercise,
        energyCost: 'high',
        targetSets: ex.sets,
        targetReps: ex.reps ?? '8-10',
        ...(ex.weight !== undefined ? { targetWeight: ex.weight } : {}),
        restSeconds: 120,
        estimatedDuration: 15,
      })),
    })),
  };
}

/**
 * Seeds one dated workout: session row + exercises + sets, all timestamped.
 * `skipped` seeds no `completedAt`/`durationMinutes`; child rows (exercises,
 * sets) still stamp with a real timestamp (the workout's own started-at +
 * fixed duration), since a skipped workout can still carry logged exercises.
 */
async function seedWorkout(
  userId: string,
  workout: Scenario['past']['workouts'][number],
  planId: string | null,
  exerciseIds: Map<string, ResolvedExercise>,
  t0: Date,
): Promise<void> {
  const startedAt = resolveRelativeTime(workout.at, t0);
  const status = workout.status ?? 'completed';
  const finishedAt = new Date(startedAt.getTime() + SEEDED_WORKOUT_MINUTES * 60_000);
  const completedAt = status === 'skipped' ? null : finishedAt;
  const childTimestamp = completedAt ?? startedAt;

  const [session] = await db
    .insert(workoutSessions)
    .values({
      userId,
      planId,
      sessionKey: workout.key,
      status,
      startedAt,
      completedAt,
      durationMinutes: status === 'skipped' ? null : SEEDED_WORKOUT_MINUTES,
      createdAt: startedAt,
      updatedAt: childTimestamp,
      lastActivityAt: childTimestamp,
    })
    .returning();

  for (const [orderIndex, ex] of workout.exercises.entries()) {
    const resolved = exerciseIds.get(ex.exercise)!;
    const [sessionExercise] = await db
      .insert(sessionExercises)
      .values({
        sessionId: session.id,
        exerciseId: resolved.id,
        orderIndex,
        status: 'completed',
        targetSets: ex.sets.length || null,
      })
      .returning();

    for (const [setIndex, set] of ex.sets.entries()) {
      await db.insert(sessionSets).values({
        sessionExerciseId: sessionExercise.id,
        setNumber: setIndex + 1,
        rpe: set.rpe ?? null,
        createdAt: childTimestamp,
        completedAt: childTimestamp,
        setData: toSetData(set, resolved.exerciseType),
      });
    }
  }
}

/**
 * Seeds the scenario's world as real rows. The user is a fresh random UUID per
 * run (isolation); `thread_id` equals `userId`, exactly what the run adapter
 * uses. `embeddingService`, when given, embeds any newly-seeded exercise
 * still missing a vector (see `resolveExerciseIds`) — the caller's
 * already-loaded instance, never a fresh one here. Left undefined, no
 * embedding is computed (every Jest scenario test).
 */
export async function seedScenarioRows(
  past: Scenario['past'],
  t0: Date,
  embeddingService?: IEmbeddingService,
): Promise<SeededScenarioWorld> {
  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    firstName: past.user.firstName ?? null,
    lastName: past.user.lastName ?? null,
    languageCode: past.user.languageCode,
    timezone: past.user.timezone,
    gender: past.user.gender ?? null,
    age: past.user.age ?? null,
    height: past.user.height !== undefined ? String(past.user.height) : null,
    weight: past.user.weight !== undefined ? String(past.user.weight) : null,
    fitnessGoal: past.user.fitnessGoal ?? null,
    fitnessLevel: past.user.fitnessLevel ?? null,
    profileStatus: past.user.registrationCompleted === false ? 'registration' : 'complete',
    createdAt: t0,
    updatedAt: t0,
  });

  const exerciseIds = await resolveExerciseIds(exerciseNamesOf(past), past.catalog ?? [], embeddingService);

  let planId: string | null = null;
  if (past.plan) {
    const [plan] = await db
      .insert(workoutPlans)
      .values({
        userId,
        name: past.plan.name,
        planJson: toPlanJson(past, exerciseIds),
        status: 'active',
        createdAt: t0,
        updatedAt: t0,
      })
      .returning();
    planId = plan.id;
  }

  for (const workout of past.workouts) {
    await seedWorkout(userId, workout, planId, exerciseIds, t0);
  }

  // Facts through the real repository (the write path is rememberFact). A fact
  // without a `durability` is a permanent, explicitly stated standing truth —
  // what every pre-lifecycle scenario means by one. A fact WITH a durability
  // keeps its class, and the CODE computes its dates from `at` (the moment it
  // was stated, default T0) via the class bounds — the seed never writes a date.
  const factsRepo = new UserFactsRepository();
  for (const f of past.facts) {
    const statedAt = f.at !== undefined ? resolveRelativeTime(f.at, t0) : t0;
    const lifecycle =
      f.durability === undefined || f.durability === 'permanent'
        ? { durability: 'permanent' as const, explicitPermanent: true }
        : {
            durability: f.durability,
            ...(f.ttlDays !== undefined ? { ttlDays: f.ttlDays } : {}),
            ...(f.reviewInDays !== undefined ? { reviewInDays: f.reviewInDays } : {}),
            ...(f.phaseNote !== undefined ? { phaseNote: f.phaseNote } : {}),
            ...(f.onExpiry !== undefined ? { onExpiry: f.onExpiry } : {}),
          };
    await factsRepo.rememberFact(
      userId,
      {
        category: f.category,
        fact: f.fact,
        ...(f.muscleGroup !== undefined && f.muscleGroup !== null ? { muscleGroup: f.muscleGroup } : {}),
        ...lifecycle,
      },
      statedAt,
    );
  }

  return { userId, planId };
}

/**
 * Seeds the durable conversation checkpoint the LangGraph way (no test-only
 * port surface): past messages ride the real `messages` channel, stored
 * episode summaries (oldest first, last 3 — BR-LLM-001..003's window) go to
 * `episodeSummaries`, `lastUserMessageAt` drives the inactivity/gap logic.
 *
 * The starting phase is `chat`: the format has no phase field in `past`, and
 * every journey of this plan begins from a completed-registration user in
 * chat.
 */
export async function seedCheckpointState(
  graph: CompiledConversationGraph,
  opts: { userId: string; past: Scenario['past']; t0: Date },
): Promise<void> {
  const { userId, past, t0 } = opts;
  const conversation = past.conversation;

  const episodeSummaries: StoredEpisodeSummary[] = [...(conversation?.summaries ?? [])]
    .map(seed => ({ at: resolveRelativeTime(seed.at, t0), seed }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-3)
    .map(({ at, seed }) => ({
      episodeId: randomUUID(),
      phaseAtEnd: seed.phaseAtEnd,
      endedAt: at.toISOString(),
      summary: {
        topics: seed.topics,
        decisions: seed.decisions,
        userState: seed.userState,
        trainingFeedback: seed.trainingFeedback,
        openItems: seed.openItems,
        facts: [],
      },
    }));

  await graph.updateState(
    { configurable: { thread_id: userId } },
    {
      phase: 'chat',
      activeSessionId: null,
      ...(conversation?.messages.length ? { messages: toBaseMessages(bindSeedMessages(conversation.messages)) } : {}),
      ...(episodeSummaries.length > 0 ? { episodeSummaries } : {}),
      ...(conversation?.lastUserMessageAt !== undefined
        ? { lastUserMessageAt: resolveRelativeTime(conversation.lastUserMessageAt, t0).toISOString() }
        : {}),
    },
  );
}
