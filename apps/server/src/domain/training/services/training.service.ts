import { ActiveSessionExistsError } from '@domain/training/errors';
import type {
  AutoCompletedExercise,
  CompletedSetDetail,
  DeletedSetsResult,
  EnsureExerciseResult,
  IEmbeddingService,
  IExerciseRepository,
  ISessionExerciseRepository,
  ISessionSetRepository,
  ITrainingService,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
  UpdateSetResult,
} from '@domain/training/ports';
import type {
  CreateSessionDto,
  CreateSessionExerciseDto,
  CreateSessionSetDto,
  SessionExercise,
  SessionRecommendation,
  SessionSet,
  SetData,
  WorkoutPlan,
  WorkoutSession,
  WorkoutSessionWithDetails,
} from '@domain/training/types';
import type { UserRepository } from '@domain/user/ports';

const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

function extractSetDetail(s: SessionSet): CompletedSetDetail {
  const detail: CompletedSetDetail = { setNumber: s.setNumber, rpe: s.rpe };
  const d = s.setData;
  if (d.type === 'strength') {
    detail.reps = d.reps;
    detail.weight = d.weight;
    detail.weightUnit = d.weightUnit ?? 'kg';
  } else if (d.type === 'functional_reps') {
    detail.reps = d.reps;
  } else if (d.type === 'cardio_duration' || d.type === 'isometric') {
    detail.duration = d.duration;
  }
  return detail;
}

function buildExerciseSummary(ex: WorkoutSessionWithDetails['exercises'][number]): AutoCompletedExercise {
  return {
    exerciseId: ex.exerciseId,
    exerciseName: ex.exercise?.name ?? `Exercise ${ex.exerciseId}`,
    setsLogged: ex.sets.length,
    sets: ex.sets.map(extractSetDetail),
    targetSets: ex.targetSets,
    targetReps: ex.targetReps,
    targetWeight: ex.targetWeight,
  };
}

export class TrainingService implements ITrainingService {
  constructor(
    private workoutPlanRepo: IWorkoutPlanRepository,
    private sessionRepo: IWorkoutSessionRepository,
    private exerciseRepo: IExerciseRepository,
    private sessionExerciseRepo: ISessionExerciseRepository,
    private sessionSetRepo: ISessionSetRepository,
    private userRepo: UserRepository,
    private embeddingService?: IEmbeddingService,
  ) {}

  async getActivePlan(userId: string): Promise<WorkoutPlan | null> {
    return this.workoutPlanRepo.findActiveByUserId(userId);
  }

  async updateSessionPlan(sessionId: string, exercises: SessionRecommendation['exercises']): Promise<WorkoutSession> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const currentPlan = (session.sessionPlanJson ?? {}) as SessionRecommendation;
    const updatedPlan: SessionRecommendation = {
      ...currentPlan,
      exercises,
    };

    return this.sessionRepo.update(sessionId, { sessionPlanJson: updatedPlan });
  }

  async startSession(userId: string, dto: CreateSessionDto): Promise<WorkoutSession> {
    // 1-2. Auto-close timed-out sessions, then refuse when one is still active
    // (only when starting a training session, not planning)
    if (dto.status === 'planning') {
      await this.autoCloseTimedOutSessions(userId);
    } else {
      await this.assertNoActiveSession(userId);
    }

    // 3. Create new session
    const session = await this.sessionRepo.create(userId, dto);

    // 4. If status is 'planning', keep it in planning. Otherwise, start immediately.
    if (dto.status === 'planning') {
      return session;
    }

    return this.sessionRepo.update(session.id, {
      status: 'in_progress',
      startedAt: new Date(),
    });
  }

  async beginSession(sessionId: string): Promise<WorkoutSession> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    if (session.status !== 'planning') {
      throw new Error(`Cannot begin session in '${session.status}' status`);
    }

    // INV-TRAINING-002: one in_progress session per user. The partial unique index is the guarantee
    // under a race (the repository turns the loser's violation into the same ActiveSessionExistsError);
    // this check gives the ordinary case its readable refusal.
    await this.assertNoActiveSession(session.userId, sessionId);

    return this.sessionRepo.update(sessionId, {
      status: 'in_progress',
      startedAt: new Date(),
    });
  }

  async addExerciseToSession(sessionId: string, dto: CreateSessionExerciseDto): Promise<SessionExercise> {
    // Update session activity
    await this.sessionRepo.updateActivity(sessionId);

    // Create exercise
    return this.sessionExerciseRepo.create(sessionId, dto);
  }

  async logSet(exerciseId: string, dto: CreateSessionSetDto): Promise<SessionSet> {
    const exercise = await this.sessionExerciseRepo.findById(exerciseId);
    if (!exercise) {
      throw new Error('Session exercise not found');
    }

    await this.sessionRepo.updateActivity(exercise.sessionId);

    const set = await this.sessionSetRepo.create(exerciseId, dto);

    if (set.setNumber === 1) {
      await this.sessionExerciseRepo.update(exerciseId, { status: 'in_progress' });
    }

    return set;
  }

  /**
   * Ensure there is an in_progress exercise in the session.
   *
   * Scenarios:
   * 1. exerciseId provided + matches plan → find/create that exercise, mark in_progress
   * 2. exerciseId provided + NOT in plan → create ad-hoc exercise with given name, mark in_progress
   * 3. No exerciseId → use current in_progress; if none, lazily create next from plan
   *
   * ADR-0011 Fix 1.3: When exerciseId differs from the current in_progress exercise,
   * auto-complete the previous one (completed if it has sets, skipped if 0 sets) before
   * opening the new one. Returns autoCompleted metadata so the tool layer can surface
   * the switch to the LLM.
   */
  async ensureCurrentExercise(
    sessionId: string,
    opts?: { exerciseId?: string; exerciseName?: string; skipActivityUpdate?: boolean },
  ): Promise<EnsureExerciseResult> {
    const session = await this.sessionRepo.findByIdWithDetails(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // An exerciseName is resolved to a catalog id FIRST; from here on the id and the name callers
    // share ONE path (existing-row reuse, switch/auto-complete, skipActivityUpdate). A second path
    // is how a name-logged set once forked the session into one row per set (AC-RRP-1).
    let exerciseId = opts?.exerciseId;
    let resolvedFromCatalog = false;
    if (!exerciseId) {
      // We cannot guess which exercise the user is doing — only a name (off-plan exercise) is acceptable.
      if (!opts?.exerciseName) {
        throw new Error('exerciseId is required to log a set. AI must identify the exercise being performed.');
      }
      exerciseId = await this.resolveExerciseIdByName(opts.exerciseName);
      resolvedFromCatalog = true;
    }

    // An id that is neither in the session nor in its plan must be a real catalog exercise. The
    // model can invent a well-formed UUID (2026-09-20: treadmill warm-up lost to an FK violation),
    // so reject it here — before any state changes — with a recovery cue the model can act on.
    // An id that came out of a catalog lookup is a catalog id by construction.
    const knownToSession =
      session.exercises.some(ex => ex.exerciseId === exerciseId) ||
      (session.sessionPlanJson?.exercises.some(ex => ex.exerciseId === exerciseId) ?? false);
    if (!resolvedFromCatalog && !knownToSession && !(await this.exerciseRepo.findById(exerciseId))) {
      throw new Error(
        `Unknown exerciseId ${exerciseId}: it is not in the exercise catalog. ` +
          'Call search_exercises and copy the ID verbatim from the results, ' +
          'or pass exerciseName instead. Never invent an id.',
      );
    }

    // Auto-complete current in_progress exercise if switching to a different one
    const currentInProgress = session.exercises.find(ex => ex.status === 'in_progress');
    let autoCompleted: AutoCompletedExercise | undefined;

    if (currentInProgress && currentInProgress.exerciseId !== exerciseId) {
      const newStatus = currentInProgress.sets.length > 0 ? 'completed' : 'skipped';
      await this.sessionExerciseRepo.update(currentInProgress.id, { status: newStatus });
      autoCompleted = buildExerciseSummary(currentInProgress);
    }

    // Check if this exercise already exists in the session
    const existing = session.exercises.find(ex => ex.exerciseId === exerciseId);
    if (existing) {
      if (existing.status !== 'in_progress') {
        await this.sessionExerciseRepo.update(existing.id, { status: 'in_progress' });
      }
      return { exercise: { ...existing, status: 'in_progress' }, autoCompleted };
    }

    // Not yet in session — create it (from plan or ad-hoc)
    const planEx = session.sessionPlanJson?.exercises.find(ex => ex.exerciseId === exerciseId);
    const created = await this.sessionExerciseRepo.create(sessionId, {
      exerciseId,
      orderIndex: session.exercises.length,
      targetSets: planEx?.targetSets,
      targetReps: planEx?.targetReps,
      targetWeight: planEx?.targetWeight ?? undefined,
    });
    await this.sessionExerciseRepo.update(created.id, { status: 'in_progress' });
    if (!opts?.skipActivityUpdate) {
      await this.sessionRepo.updateActivity(sessionId);
    }
    return { exercise: { ...created, status: 'in_progress' }, autoCompleted };
  }

  async completeSession(sessionId: string, durationMinutes?: number, completedAt?: Date): Promise<WorkoutSession> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const exercises = await this.sessionExerciseRepo.findBySessionId(sessionId);
    for (const ex of exercises) {
      if (ex.status === 'in_progress') {
        await this.sessionExerciseRepo.update(ex.id, { status: 'completed' });
      }
    }

    const resolvedCompletedAt = completedAt ?? new Date();
    const duration =
      durationMinutes ??
      (session.startedAt ? Math.floor((resolvedCompletedAt.getTime() - session.startedAt.getTime()) / 60000) : null);

    return this.sessionRepo.complete(sessionId, resolvedCompletedAt, duration ?? 0);
  }

  async skipSession(sessionId: string): Promise<WorkoutSession> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return this.sessionRepo.update(sessionId, { status: 'skipped' });
  }

  async getActiveSession(userId: string): Promise<WorkoutSessionWithDetails | null> {
    await this.autoCloseTimedOutSessions(userId);

    // Check in_progress first, then planning
    const inProgress = await this.sessionRepo.findActiveByUserId(userId);
    if (inProgress) {
      return this.sessionRepo.findByIdWithDetails(inProgress.id);
    }

    const recent = await this.sessionRepo.findRecentByUserIdWithDetails(userId, 1);
    const planning = recent.find(s => s.status === 'planning');
    return planning ?? null;
  }

  async getTrainingHistory(userId: string, limit = 10): Promise<WorkoutSessionWithDetails[]> {
    return this.sessionRepo.findRecentByUserIdWithDetails(userId, limit);
  }

  async getSessionDetails(sessionId: string): Promise<WorkoutSessionWithDetails | null> {
    return this.sessionRepo.findByIdWithDetails(sessionId);
  }

  async completeCurrentExercise(sessionId: string): Promise<AutoCompletedExercise> {
    const session = await this.sessionRepo.findByIdWithDetails(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const currentExercise = session.exercises.find(ex => ex.status === 'in_progress');
    if (!currentExercise) {
      throw new Error('No exercise currently in progress');
    }

    await this.sessionExerciseRepo.update(currentExercise.id, { status: 'completed' });
    await this.sessionRepo.updateActivity(sessionId);

    return buildExerciseSummary(currentExercise);
  }

  async logSetWithContext(
    sessionId: string,
    opts: {
      exerciseId?: string;
      exerciseName?: string;
      setData: SetData;
      rpe?: number;
      feedback?: string;
      createdAt?: Date;
      skipActivityUpdate?: boolean;
    },
  ): Promise<{ set: SessionSet; setNumber: number; autoCompleted?: AutoCompletedExercise }> {
    const { exercise: sessionExercise, autoCompleted } = await this.ensureCurrentExercise(sessionId, {
      exerciseId: opts.exerciseId,
      exerciseName: opts.exerciseName,
      skipActivityUpdate: opts.skipActivityUpdate,
    });

    const set = opts.skipActivityUpdate
      ? await this.sessionSetRepo.create(sessionExercise.id, {
          setData: opts.setData,
          rpe: opts.rpe,
          userFeedback: opts.feedback,
          createdAt: opts.createdAt,
        })
      : await this.logSet(sessionExercise.id, {
          setData: opts.setData,
          rpe: opts.rpe,
          userFeedback: opts.feedback,
          createdAt: opts.createdAt,
        });

    return { set, setNumber: set.setNumber, autoCompleted };
  }

  /**
   * ADR-0011 Phase 2 Fix 2.1 — Delete the last N sets for a given exercise.
   *
   * Finds the most-recently-logged sets (ordered by setNumber DESC) and deletes them.
   * Default count = 1. Returns details of what was deleted so the tool can surface a
   * human-readable confirmation to the LLM.
   */
  async deleteLastSets(sessionId: string, exerciseId: string, count = 1): Promise<DeletedSetsResult> {
    const session = await this.sessionRepo.findByIdWithDetails(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const sessionExercise = session.exercises.find(ex => ex.exerciseId === exerciseId);
    if (!sessionExercise) {
      throw new Error(`Exercise ${exerciseId} not found in session ${sessionId}`);
    }

    const setsToDelete = sessionExercise.sets
      .slice()
      .sort((a, b) => b.setNumber - a.setNumber)
      .slice(0, count);

    if (setsToDelete.length === 0) {
      throw new Error(`No sets found for exercise ${exerciseId} in session ${sessionId}`);
    }

    for (const s of setsToDelete) {
      await this.sessionSetRepo.deleteById(s.id);
    }

    return {
      exerciseId,
      deletedSets: setsToDelete.map(s => ({
        setNumber: s.setNumber,
        setData: s.setData,
        rpe: s.rpe,
      })),
    };
  }

  /**
   * ADR-0011 Phase 2 Fix 2.2 — Update the last logged set for a given exercise.
   *
   * Merges the provided field updates into the existing setData. Returns a before/after
   * diff so the LLM can describe what was changed.
   */
  async updateLastSet(
    sessionId: string,
    exerciseId: string,
    updates: {
      rpe?: number;
      feedback?: string;
      weight?: number;
      reps?: number;
      durationSeconds?: number;
      distanceKm?: number;
      inclinePct?: number;
    },
  ): Promise<UpdateSetResult> {
    const session = await this.sessionRepo.findByIdWithDetails(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const sessionExercise = session.exercises.find(ex => ex.exerciseId === exerciseId);
    if (!sessionExercise) {
      throw new Error(`Exercise ${exerciseId} not found in session ${sessionId}`);
    }

    const lastSet = sessionExercise.sets.reduce<(typeof sessionExercise.sets)[0] | null>(
      (max, s) => (s.setNumber > (max?.setNumber ?? -Infinity) ? s : max),
      null,
    );

    if (!lastSet) {
      throw new Error(`No sets found for exercise ${exerciseId} in session ${sessionId}`);
    }

    const before = {
      setData: lastSet.setData,
      rpe: lastSet.rpe,
      userFeedback: lastSet.userFeedback,
    };

    const updatedSetData: SessionSet['setData'] = {
      ...lastSet.setData,
      ...(updates.weight != null ? { weight: updates.weight } : {}),
      ...(updates.reps != null ? { reps: updates.reps } : {}),
      ...(updates.durationSeconds != null ? { duration: updates.durationSeconds } : {}),
      ...(updates.distanceKm != null ? { distance: updates.distanceKm, distanceUnit: 'km' } : {}),
      ...(updates.inclinePct != null ? { inclinePct: updates.inclinePct } : {}),
    };

    const updatedSet = await this.sessionSetRepo.update(lastSet.id, {
      setData: updatedSetData,
      ...(updates.rpe != null ? { rpe: updates.rpe } : {}),
      ...(updates.feedback != null ? { userFeedback: updates.feedback } : {}),
    });

    return {
      exerciseId,
      setNumber: lastSet.setNumber,
      before,
      after: {
        setData: updatedSet.setData,
        rpe: updatedSet.rpe,
        userFeedback: updatedSet.userFeedback,
      },
    };
  }

  // --- Private helpers ---

  /**
   * INV-TRAINING-002, the one place the refusal is written: stale sessions are auto-closed first, then
   * any active session other than `exceptSessionId` (the one being begun) refuses the caller.
   */
  private async assertNoActiveSession(userId: string, exceptSessionId?: string): Promise<void> {
    await this.autoCloseTimedOutSessions(userId);
    const activeSession = await this.sessionRepo.findActiveByUserId(userId);
    if (activeSession && activeSession.id !== exceptSessionId) {
      throw new ActiveSessionExistsError();
    }
  }

  /**
   * Resolves an exercise name to a catalog id: exact (case-insensitive) match first, then the
   * semantic fallback (embedding search), then the ilike hit when no embedding service is wired.
   * A name that matches nothing fails with the existing "not found" rejection.
   */
  private async resolveExerciseIdByName(exerciseName: string): Promise<string> {
    const exactMatches = await this.exerciseRepo.search(exerciseName, 1);
    const exactMatch = exactMatches.find(ex => ex.name.toLowerCase() === exerciseName.toLowerCase());
    let resolvedExerciseId: string | undefined;
    if (exactMatch) {
      resolvedExerciseId = exactMatch.id;
    } else if (this.embeddingService) {
      // Semantic fallback: embed the exercise name and find the closest match
      const queryVector = await this.embeddingService.embed(exerciseName);
      const semanticMatches = await this.exerciseRepo.searchByEmbedding(queryVector, { limit: 1 });
      const [topMatch] = semanticMatches;
      if (topMatch) {
        resolvedExerciseId = topMatch.id;
      }
    } else {
      // No embedding service — reuse the ilike result from exact match attempt
      const [topIlike] = exactMatches;
      if (topIlike) {
        resolvedExerciseId = topIlike.id;
      }
    }

    if (!resolvedExerciseId) {
      throw new Error(`Exercise "${exerciseName}" not found in DB. Cannot log set for unknown exercise.`);
    }
    return resolvedExerciseId;
  }

  private async autoCloseTimedOutSessions(userId: string): Promise<void> {
    const cutoffTime = new Date(Date.now() - SESSION_TIMEOUT_MS);
    await this.sessionRepo.autoCloseTimedOut(userId, cutoffTime);
  }
}
