import { ActiveSessionExistsError, ExerciseNotFoundError } from '@domain/training/errors';
import { isValidExerciseId } from '@domain/training/plan-exercise-id';
import type {
  AutoCompletedExercise,
  CompletedSetDetail,
  DeletedSetsResult,
  EnsureExerciseResult,
  IEmbeddingService,
  IExerciseRepository,
  ILoadRecommendationLog,
  ISessionExerciseRepository,
  ISessionSetRepository,
  ITrainingService,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
  LoadPlanLogContext,
  LoadRecommendationOutcome,
  PendingLoadRecommendation,
  UpdateSetResult,
} from '@domain/training/ports';
import { isLateStart, resolveCompletion, SESSION_TIMEOUT_MS } from '@domain/training/session-timing';
import type {
  CreateSessionDto,
  CreateSessionExerciseDto,
  CreateSessionSetDto,
  SessionExercise,
  SessionRecommendation,
  SessionSet,
  SetData,
  SetKind,
  WorkoutPlan,
  WorkoutSession,
  WorkoutSessionWithDetails,
} from '@domain/training/types';
import type { UserRepository } from '@domain/user/ports';

function extractSetDetail(s: SessionSet): CompletedSetDetail {
  const detail: CompletedSetDetail = { setNumber: s.setNumber, rpe: s.rpe, setKind: s.setKind };
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
    // load-plan plan Task 3 (A5): present only with LOAD_PLAN_SUGGESTION on; absent = pre-plan behaviour.
    private loadLog?: ILoadRecommendationLog,
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
      await this.recordLoadOutcome(currentInProgress);
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
    // set-kind plan Task 2 (D7): with details — reconciliation needs each row's sets.
    const session = await this.sessionRepo.findByIdWithDetails(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    await this.reconcilePlanItems(session);
    // An exercise left open when the workout ends is finished with it (no-op without the log or a row).
    for (const ex of session.exercises) {
      if (ex.status === 'in_progress') {
        await this.recordLoadOutcome(ex);
      }
    }

    // BUG-043: completion never precedes the start, duration never negative.
    const resolved = resolveCompletion(session.startedAt, completedAt ?? new Date());

    return this.sessionRepo.complete(sessionId, resolved.completedAt, durationMinutes ?? resolved.durationMinutes ?? 0);
  }

  async skipSession(sessionId: string): Promise<WorkoutSession> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return this.sessionRepo.update(sessionId, { status: 'skipped' });
  }

  /**
   * set-kind plan Task 2 (D6): record where today's session is happening — free text in the
   * user's own words, written by `set_session_place` (and by `start_training_session`'s
   * optional `place` argument at creation).
   */
  async setSessionPlace(sessionId: string, place: string): Promise<WorkoutSession> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return this.sessionRepo.update(sessionId, { place });
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
    await this.recordLoadOutcome(currentExercise);
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
      setKind?: SetKind;
      weightBasis?: 'total';
      loadPlanLog?: LoadPlanLogContext;
    },
  ): Promise<{ set: SessionSet; setNumber: number; autoCompleted?: AutoCompletedExercise }> {
    // BUG-043: the first live set of a session that never had one (plan accepted long ago) is when the
    // workout really began — re-anchor `startedAt` there. Read BEFORE ensureCurrentExercise bumps activity.
    if (!opts.skipActivityUpdate) {
      const before = await this.sessionRepo.findByIdWithDetails(sessionId);
      if (before?.startedAt && isLateStart(before, new Date())) {
        await this.sessionRepo.update(sessionId, { startedAt: new Date() });
      }
    }

    const { exercise: sessionExercise, autoCompleted } = await this.ensureCurrentExercise(sessionId, {
      exerciseId: opts.exerciseId,
      exerciseName: opts.exerciseName,
      skipActivityUpdate: opts.skipActivityUpdate,
    });

    // set-kind plan Task 1 (D2, D3): the app layer, not the DB, defaults to 'working' — the DB
    // default stays absent so legacy (pre-plan) rows keep reading NULL.
    const setKind: SetKind = opts.setKind ?? 'working';
    const setData = await this.applyPerHand(sessionExercise.exerciseId, opts.setData, opts.weightBasis);

    // D7: the entry is rendered BEFORE this set exists, so "today" excludes it; written after it is stored.
    const pendingLoad = await this.prepareLoadRecommendation(sessionId, sessionExercise, setKind, opts.loadPlanLog);

    const set = opts.skipActivityUpdate
      ? await this.sessionSetRepo.create(sessionExercise.id, {
          setData,
          rpe: opts.rpe,
          userFeedback: opts.feedback,
          createdAt: opts.createdAt,
          setKind,
        })
      : await this.logSet(sessionExercise.id, {
          setData,
          rpe: opts.rpe,
          userFeedback: opts.feedback,
          createdAt: opts.createdAt,
          setKind,
        });

    if (pendingLoad) {
      await this.loadLog?.commit(pendingLoad);
    }

    return { set, setNumber: set.setNumber, autoCompleted };
  }

  /** D7 trigger: the first WORKING set of a session exercise (warm-ups never count). */
  private async prepareLoadRecommendation(
    sessionId: string,
    sessionExercise: SessionExercise,
    setKind: SetKind,
    ctx?: LoadPlanLogContext,
  ): Promise<PendingLoadRecommendation | null> {
    if (!this.loadLog || !ctx || setKind === 'warmup') {
      return null;
    }
    const earlier = await this.sessionSetRepo.findByExerciseId(sessionExercise.id);
    if (earlier.some(s => s.setKind !== 'warmup')) {
      return null;
    }
    const session = await this.sessionRepo.findByIdWithDetails(sessionId);
    if (!session) {
      return null;
    }
    return this.loadLog.prepare({
      userId: session.userId,
      session,
      sessionExerciseId: sessionExercise.id,
      exerciseId: sessionExercise.exerciseId,
      ctx,
    });
  }

  /** D7: what was done on the exercise — its working sets — once it completes. */
  private async recordLoadOutcome(ex: WorkoutSessionWithDetails['exercises'][number]): Promise<void> {
    if (!this.loadLog) {
      return;
    }
    const sets: LoadRecommendationOutcome['sets'] = ex.sets
      .filter(s => s.setKind !== 'warmup')
      .map(s => {
        const { setKind: _kind, ...detail } = extractSetDetail(s);
        return detail;
      });
    await this.loadLog.recordOutcome(ex.id, { sets });
  }

  /**
   * set-kind plan Task 1 (D5): resolves the exercise's catalog equipment once and, for a
   * dumbbell exercise's strength set, sets `perHand` — true by default, false when the caller
   * said the weight is a total. Every other equipment leaves `setData` untouched (no `perHand`
   * key at all).
   */
  private async applyPerHand(exerciseId: string, setData: SetData, weightBasis?: 'total'): Promise<SetData> {
    if (setData.type !== 'strength') {
      return setData;
    }
    const exercise = await this.exerciseRepo.findById(exerciseId);
    if (exercise?.equipment !== 'dumbbell') {
      return setData;
    }
    return { ...setData, perHand: weightBasis !== 'total' };
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
      setKind?: SetKind;
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
      setKind: lastSet.setKind,
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
      ...(updates.setKind != null ? { setKind: updates.setKind } : {}),
    });

    return {
      exerciseId,
      setNumber: lastSet.setNumber,
      before,
      after: {
        setData: updatedSet.setData,
        rpe: updatedSet.rpe,
        userFeedback: updatedSet.userFeedback,
        setKind: updatedSet.setKind,
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
  async resolveExerciseIdByName(exerciseName: string): Promise<string> {
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
      throw new ExerciseNotFoundError(exerciseName);
    }
    return resolvedExerciseId;
  }

  private async autoCloseTimedOutSessions(userId: string): Promise<void> {
    const cutoffTime = new Date(Date.now() - SESSION_TIMEOUT_MS);
    // set-kind plan Task 2 (D7): a timed-out session reconciles through the SAME path as an
    // explicit finish — reconcile before the repo marks the sessions completed.
    const timedOut = await this.sessionRepo.findTimedOut(cutoffTime);
    for (const session of timedOut) {
      if (session.userId !== userId) {
        continue;
      }
      const details = await this.sessionRepo.findByIdWithDetails(session.id);
      if (details) {
        await this.reconcilePlanItems(details);
      }
    }
    await this.sessionRepo.autoCloseTimedOut(userId, cutoffTime);
  }

  /**
   * set-kind plan Task 2 (D7, BUG-042): finish reconciliation, the one path shared by
   * `completeSession` and the auto-close of timed-out sessions.
   * (a) every `session_plan_json` exercise with a valid id and no `session_exercises` row
   *     gets one with `status = 'skipped'` and the plan's targets — a planned exercise the
   *     user never touched stops vanishing;
   * (b) an `in_progress` (or still-`pending`) row with zero sets ends `skipped`, not
   *     `completed` — the same rule `ensureCurrentExercise` applies on a switch.
   */
  private async reconcilePlanItems(session: WorkoutSessionWithDetails): Promise<void> {
    for (const ex of session.exercises) {
      if (ex.status === 'in_progress' || ex.status === 'pending') {
        const newStatus = ex.sets.length > 0 ? 'completed' : 'skipped';
        await this.sessionExerciseRepo.update(ex.id, { status: newStatus });
      }
    }

    const existingIds = new Set(session.exercises.map(ex => ex.exerciseId));
    let orderIndex = session.exercises.length;
    for (const planEx of session.sessionPlanJson?.exercises ?? []) {
      if (!isValidExerciseId(planEx.exerciseId) || existingIds.has(planEx.exerciseId)) {
        continue;
      }
      // A well-formed UUID that is not a real catalog exercise (stale/bad plan row) would violate
      // the exercise FK — check existence first, never rely on the DB to reject (close-out review
      // advisory R3).
      const exercise = await this.exerciseRepo.findById(planEx.exerciseId);
      if (!exercise) {
        continue;
      }
      // Marked BEFORE the write so a plan id repeated in session_plan_json (bad data) creates one
      // skipped row, not one per occurrence (close-out review advisory R3).
      existingIds.add(planEx.exerciseId);
      const created = await this.sessionExerciseRepo.create(session.id, {
        exerciseId: planEx.exerciseId,
        orderIndex: orderIndex++,
        targetSets: planEx.targetSets,
        targetReps: planEx.targetReps,
        targetWeight: planEx.targetWeight ?? undefined,
      });
      await this.sessionExerciseRepo.update(created.id, { status: 'skipped' });
    }
  }
}
