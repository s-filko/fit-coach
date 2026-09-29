/**
 * load-facts plan D11: the one loader shared by the `LOAD PLAN` block and the `get_load_plan` tool.
 * It only gathers repository rows and maps them onto the pure module's plain inputs
 * (`@domain/training/load-facts`); every number is computed there. `now` and `timezone` are
 * arguments — the loader never reads the clock.
 */
import {
  computeLoadFacts,
  type ConstraintInput,
  type ExerciseInput,
  type LoadFacts,
  type OtherSetInput,
  type PerformanceInput,
  type SetInput,
  type TodayInput,
  type WorkoutSummaryInput,
} from '@domain/training/load-facts';
import type { IExerciseRepository, ITrainingService, IWorkoutSessionRepository } from '@domain/training/ports';
import type {
  ExerciseWithMuscles,
  MuscleGroup,
  SessionExerciseWithDetails,
  SessionSet,
  WorkoutSessionWithDetails,
} from '@domain/training/types';
import type { IUserFactsService } from '@domain/user/ports';

/** D11: how many recent real workouts feed the metrics (56-day window + the run for K and norms). */
export const LOAD_FACTS_RECENT_WORKOUTS = 60;

/** A uuid-typed exclusion needs a real uuid; used only when there is no active session at all. */
const NO_SESSION_ID = '00000000-0000-0000-0000-000000000000';

export interface LoadPlanEntry {
  exercise: ExerciseInput;
  facts: LoadFacts;
}

export interface LoadFactsLoaderDeps {
  workoutSessionRepo: Pick<
    IWorkoutSessionRepository,
    'findRecentByUserIdWithDetails' | 'findLastPerformancesByExercise' | 'countRealPerformancesByExercise'
  >;
  exerciseRepository: Pick<IExerciseRepository, 'findByIdsWithMuscles'>;
  trainingService: Pick<ITrainingService, 'getSessionDetails'>;
  userFacts: Pick<IUserFactsService, 'getConstraints' | 'getForPrompt'>;
}

export interface LoadFactsParams {
  userId: string;
  /** Today's session with details; null when there is none (the tool's defensive case). */
  session: WorkoutSessionWithDetails | null;
  /** Exercises to compute, in output order. */
  exerciseIds: string[];
  /** Target reps of today's plan items, for exercises without a `session_exercises` row yet. */
  planTargetReps: Map<string, string>;
  now: Date;
  timezone: string | null;
}

function toExerciseInput(e: ExerciseWithMuscles): ExerciseInput {
  return {
    id: e.id,
    name: e.name,
    exerciseType: e.exerciseType,
    equipment: e.equipment,
    muscles: (e.muscleGroups ?? []).map(m => ({ muscleGroup: m.muscleGroup, involvement: m.involvement })),
  };
}

function toSetInput(s: SessionSet): SetInput {
  return { setData: s.setData, setKind: s.setKind, rpe: s.rpe, userFeedback: s.userFeedback, createdAt: s.createdAt };
}

function toOtherSets(session: WorkoutSessionWithDetails, exerciseRowId: string): OtherSetInput[] {
  return session.exercises
    .filter(ex => ex.id !== exerciseRowId)
    .flatMap(ex =>
      ex.sets.map(s => ({
        exerciseName: ex.exercise.name,
        muscles: (ex.exercise.muscleGroups ?? []).map(m => ({
          muscleGroup: m.muscleGroup,
          involvement: m.involvement,
        })),
        setKind: s.setKind,
        createdAt: s.createdAt,
      })),
    );
}

function performedAt(session: WorkoutSessionWithDetails): Date {
  return session.completedAt ?? session.createdAt;
}

function toPerformances(session: WorkoutSessionWithDetails, exerciseId: string): PerformanceInput[] {
  return session.exercises
    .filter(ex => ex.exerciseId === exerciseId && ex.sets.length > 0)
    .map(ex => ({
      id: ex.id,
      sessionId: session.id,
      performedAt: performedAt(session),
      place: session.place,
      startedAt: session.startedAt,
      targetReps: ex.targetReps,
      sets: ex.sets.map(toSetInput),
      otherSets: toOtherSets(session, ex.id),
    }));
}

function toWorkoutSummary(session: WorkoutSessionWithDetails): WorkoutSummaryInput {
  const primary = new Set<MuscleGroup>();
  for (const ex of session.exercises) {
    if (ex.sets.length === 0) {
      continue;
    }
    for (const m of ex.exercise.muscleGroups ?? []) {
      if (m.involvement === 'primary') {
        primary.add(m.muscleGroup);
      }
    }
  }
  return { sessionId: session.id, performedAt: performedAt(session), primaryMuscles: [...primary] };
}

function buildToday(params: LoadFactsParams, exerciseId: string): TodayInput {
  const { session } = params;
  const planReps = params.planTargetReps.get(exerciseId) ?? null;
  if (!session) {
    return { sessionId: NO_SESSION_ID, place: null, startedAt: null, targetReps: planReps, sets: [], otherSets: [] };
  }
  const own: SessionExerciseWithDetails[] = session.exercises.filter(ex => ex.exerciseId === exerciseId);
  const ownIds = new Set(own.map(ex => ex.id));
  return {
    sessionId: session.id,
    place: session.place,
    startedAt: session.startedAt,
    // D8: the started row's own target reps, else the plan item's.
    targetReps: own.find(ex => ex.targetReps)?.targetReps ?? planReps,
    sets: own.flatMap(ex => ex.sets.map(toSetInput)),
    otherSets: session.exercises
      .filter(ex => !ownIds.has(ex.id))
      .flatMap(ex => toOtherSets({ ...session, exercises: [ex] }, '')),
  };
}

/** Sessions to mine: the recent real workouts, plus — for an exercise none of them contains — the
 * one session of its last real performance (D11 fallback, for a fatigue context and a reference). */
async function loadSessions(
  deps: LoadFactsLoaderDeps,
  params: LoadFactsParams,
  todayId: string,
): Promise<WorkoutSessionWithDetails[]> {
  const recent = (
    await deps.workoutSessionRepo.findRecentByUserIdWithDetails(params.userId, LOAD_FACTS_RECENT_WORKOUTS, {
      realWorkoutsOnly: true,
    })
  ).filter(s => s.id !== todayId);
  const covered = new Set(recent.flatMap(s => s.exercises.filter(ex => ex.sets.length > 0).map(ex => ex.exerciseId)));
  const missing = params.exerciseIds.filter(id => !covered.has(id));
  if (missing.length === 0) {
    return recent;
  }
  const last = await deps.workoutSessionRepo.findLastPerformancesByExercise(params.userId, missing, todayId);
  const known = new Set(recent.map(s => s.id));
  const extra: WorkoutSessionWithDetails[] = [];
  for (const sessionId of new Set(last.map(p => p.sessionExercise.sessionId))) {
    const details = known.has(sessionId) ? null : await deps.trainingService.getSessionDetails(sessionId);
    if (details) {
      extra.push(details);
    }
  }
  return [...recent, ...extra];
}

async function loadFactsContext(
  deps: LoadFactsLoaderDeps,
  params: LoadFactsParams,
): Promise<{ constraints: ConstraintInput[]; equipmentFacts: string[] }> {
  const [constraintFacts, promptFacts] = await Promise.all([
    deps.userFacts.getConstraints(params.userId, params.now),
    deps.userFacts.getForPrompt(params.userId, params.now),
  ]);
  return {
    constraints: constraintFacts.map(f => ({
      muscleGroup: (f.muscleGroup as MuscleGroup | null) ?? null,
      durability: f.durability,
      text: f.fact,
    })),
    equipmentFacts: promptFacts.filter(f => f.category === 'equipment').map(f => f.fact),
  };
}

/** One `LoadPlanEntry` per requested exercise (unknown ids are left out), computed for `now`. */
export async function loadLoadPlanEntries(
  deps: LoadFactsLoaderDeps,
  params: LoadFactsParams,
): Promise<LoadPlanEntry[]> {
  if (params.exerciseIds.length === 0) {
    return [];
  }
  const todayId = params.session?.id ?? NO_SESSION_ID;
  const [catalog, sessions, counts, factsCtx] = await Promise.all([
    deps.exerciseRepository.findByIdsWithMuscles(params.exerciseIds),
    loadSessions(deps, params, todayId),
    deps.workoutSessionRepo.countRealPerformancesByExercise(
      params.userId,
      params.exerciseIds,
      params.session?.id ?? null,
    ),
    loadFactsContext(deps, params),
  ]);
  const byId = new Map(catalog.map(e => [e.id, toExerciseInput(e)]));
  const workouts = sessions.map(toWorkoutSummary);

  const entries: LoadPlanEntry[] = [];
  for (const id of params.exerciseIds) {
    const exercise = byId.get(id);
    if (!exercise) {
      continue;
    }
    const performances = sessions.flatMap(s => toPerformances(s, id));
    const facts = computeLoadFacts(
      exercise,
      performances,
      buildToday(params, id),
      { ...factsCtx, workouts, allTimePerformances: counts.get(id) ?? 0 },
      params.now,
      params.timezone,
    );
    entries.push({ exercise, facts });
  }
  return entries;
}

/** Target reps of today's plan items by exercise id (D8: used when the exercise has no row yet). */
export function planTargetRepsOf(session: WorkoutSessionWithDetails | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of session?.sessionPlanJson?.exercises ?? []) {
    if (item.targetReps) {
      map.set(item.exerciseId, item.targetReps);
    }
  }
  return map;
}
