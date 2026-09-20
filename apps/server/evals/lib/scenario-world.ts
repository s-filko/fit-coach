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
import type { CompiledConversationGraph } from '@infra/ai/graph/conversation.graph';
import { UserFactsRepository } from '@infra/db/repositories/user-facts.repository';
import { db } from '@infra/db/drizzle';
import { exercises, sessionExercises, sessionSets, users, workoutPlans, workoutSessions } from '@infra/db/schema';
import type { WorkoutPlanJson } from '@domain/training/types';

import { bindSeedMessages } from '../schema/case.schema';
import { resolveRelativeTime, type Scenario } from '../schema/scenario.schema';

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

/**
 * Resolves exercise names to ids. Names already in the catalog (the test
 * setup's four) are reused; anything else is seeded as a generic strength
 * exercise — `ON CONFLICT (name) DO NOTHING` keeps a repeat run idempotent
 * within one schema lifetime.
 */
async function resolveExerciseIds(names: string[]): Promise<Map<string, string>> {
  for (const name of names) {
    await db
      .insert(exercises)
      .values({
        id: randomUUID(),
        name,
        category: 'compound',
        equipment: 'barbell',
        exerciseType: 'strength',
        description: 'Scenario seed exercise',
        energyCost: 'medium',
        complexity: 'intermediate',
        typicalDurationMinutes: 12,
        requiresSpotter: false,
      })
      .onConflictDoNothing({ target: exercises.name });
  }
  const rows = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    .where(inArray(exercises.name, names));
  return new Map(rows.map(r => [r.name, r.id]));
}

/** Builds the `planJson` the `save_workout_plan` tool would have written. */
function toPlanJson(past: Scenario['past'], exerciseIds: Map<string, string>): WorkoutPlanJson {
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
        exerciseId: exerciseIds.get(ex.exercise)!,
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

/** Seeds one dated workout: session row + exercises + sets, all timestamped. */
async function seedWorkout(
  userId: string,
  workout: Scenario['past']['workouts'][number],
  planId: string | null,
  exerciseIds: Map<string, string>,
  t0: Date,
): Promise<void> {
  const startedAt = resolveRelativeTime(workout.at, t0);
  const completedAt = new Date(startedAt.getTime() + SEEDED_WORKOUT_MINUTES * 60_000);
  const [session] = await db
    .insert(workoutSessions)
    .values({
      userId,
      planId,
      sessionKey: workout.key,
      status: 'completed',
      startedAt,
      completedAt,
      durationMinutes: SEEDED_WORKOUT_MINUTES,
      createdAt: startedAt,
      updatedAt: completedAt,
      lastActivityAt: completedAt,
    })
    .returning();

  for (const [orderIndex, ex] of workout.exercises.entries()) {
    const [sessionExercise] = await db
      .insert(sessionExercises)
      .values({
        sessionId: session.id,
        exerciseId: exerciseIds.get(ex.exercise)!,
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
        createdAt: completedAt,
        completedAt,
        setData: {
          type: 'strength',
          reps: set.reps,
          ...(set.weight !== undefined ? { weight: set.weight } : {}),
        },
      });
    }
  }
}

/**
 * Seeds the scenario's world as real rows. The user is a fresh random UUID per
 * run (isolation); `thread_id` equals `userId`, exactly what the run adapter
 * uses.
 */
export async function seedScenarioRows(past: Scenario['past'], t0: Date): Promise<SeededScenarioWorld> {
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

  const exerciseIds = await resolveExerciseIds(exerciseNamesOf(past));

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
