import type { LLMService } from '@domain/ai/ports';
import type {
  IEmbeddingService,
  IExerciseRepository,
  ISessionExerciseRepository,
  ISessionSetRepository,
  ITrainingService,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import type {
  AutoCompletedExercise,
  CompletedSetDetail,
  DeletedSetsResult,
  EnsureExerciseResult,
  UpdateSetResult,
} from '@domain/training/ports/service.ports';
import type {
  CreateSessionDto,
  CreateSessionExerciseDto,
  CreateSessionSetDto,
  SessionExercise,
  SessionRecommendation,
  SessionSet,
  SetData,
  UserProfile,
  WorkoutPlan,
  WorkoutSession,
  WorkoutSessionWithDetails,
} from '@domain/training/types';
import type { ChatMsg, UserRepository } from '@domain/user/ports';

import { buildSessionRecommendationPrompt } from './prompts/session-recommendation.prompt';

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
    private llmService: LLMService,
    private embeddingService?: IEmbeddingService,
  ) {}

  async getActivePlan(userId: string): Promise<WorkoutPlan | null> {
    return this.workoutPlanRepo.findActiveByUserId(userId);
  }

  async createPlanFromPrompt(
    userId: string,
    params: { goal: string; daysPerWeek: number; equipment?: string },
  ): Promise<WorkoutPlan> {
    // Archive existing active plan
    const existing = await this.workoutPlanRepo.findActiveByUserId(userId);
    if (existing) {
      await this.workoutPlanRepo.archive(existing.id);
    }

    const userEntity = await this.userRepo.getById(userId);
    const prompt = `Create a workout plan for:
- Goal: ${params.goal}
- Days per week: ${params.daysPerWeek}
- Equipment: ${params.equipment ?? 'full gym'}
- User: ${userEntity?.gender ?? 'N/A'}, age ${userEntity?.age ?? 'N/A'}, ${userEntity?.weight ?? 'N/A'}kg, level: ${userEntity?.fitnessLevel ?? 'beginner'}

Return JSON with this structure:
{
  "name": "Plan Name",
  "goal": "${params.goal}",
  "trainingStyle": "hypertrophy|strength|endurance|functional",
  "targetMuscleGroups": ["chest", "back", ...],
  "sessionTemplates": [
    {
      "key": "day_1",
      "name": "Session Name",
      "focus": "What muscles",
      "energyCost": "high|medium|low",
      "estimatedDuration": 60,
      "exercises": [
        {
          "exerciseId": "00000000-0000-0000-0000-000000000000",
          "exerciseName": "Exercise Name",
          "energyCost": "high|medium|low",
          "targetSets": 3,
          "targetReps": "8-10",
          "targetWeight": 0,
          "restSeconds": 90,
          "estimatedDuration": 10
        }
      ]
    }
  ],
  "recoveryGuidelines": {
    "majorMuscleGroups": { "minRestDays": 2, "maxRestDays": 4 },
    "smallMuscleGroups": { "minRestDays": 1, "maxRestDays": 3 },
    "highIntensity": { "minRestDays": 2 },
    "customRules": []
  },
  "progressionRules": ["rule1", "rule2"]
}`;

    const messages: ChatMsg[] = [{ role: 'user', content: prompt }];
    const raw = await this.llmService.generateWithSystemPrompt(
      messages,
      'You are an expert fitness coach. Create a detailed workout plan. Return valid JSON only.',
      { jsonMode: true },
    );

    const planData = JSON.parse(raw) as WorkoutPlan['planJson'] & { name?: string };
    const planName = planData.name ?? `${params.goal} Plan`;

    return this.workoutPlanRepo.create(userId, {
      name: planName,
      planJson: planData,
      status: 'active',
    });
  }

  async getNextSessionRecommendation(userId: string): Promise<SessionRecommendation> {
    // 1. Get user profile
    const userEntity = await this.userRepo.getById(userId);
    if (!userEntity) {
      throw new Error('User not found');
    }

    const user: UserProfile = {
      id: userEntity.id,
      gender: userEntity.gender ?? null,
      age: userEntity.age ?? null,
      height: userEntity.height ?? null,
      weight: userEntity.weight ?? null,
      fitnessGoal: userEntity.fitnessGoal ?? null,
      fitnessLevel: userEntity.fitnessLevel ?? null,
    };

    // 3. Get active plan
    const plan = await this.workoutPlanRepo.findActiveByUserId(userId);
    if (!plan) {
      throw new Error('No active workout plan found. Please create a plan first.');
    }

    // 4. Get last 5 sessions with full details
    const recentSessions = await this.sessionRepo.findRecentByUserIdWithDetails(userId, 5);

    // 5. Build AI prompt
    const prompt = await buildSessionRecommendationPrompt(user, plan, recentSessions);

    // 6. Get AI recommendation
    const messages: ChatMsg[] = [{ role: 'user', content: prompt }];
    const rawResponse = await this.llmService.generateWithSystemPrompt(
      messages,
      'You are an expert fitness coach analyzing training history and providing personalized workout recommendations.',
      { jsonMode: true },
    );

    // 7. Parse and validate response
    const recommendation = JSON.parse(rawResponse) as SessionRecommendation;

    return recommendation;
  }

  async recommendForSession(sessionId: string, userId: string, comment?: string): Promise<SessionRecommendation> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.userId !== userId) throw new Error('Access denied');

    let recommendation: SessionRecommendation;
    const hasPlan = !!(await this.workoutPlanRepo.findActiveByUserId(userId));

    if (hasPlan) {
      recommendation = await this.getNextSessionRecommendation(userId);
    } else {
      recommendation = await this.generateFreeformRecommendation(userId);
    }

    // If user left a comment, ask AI to adjust the plan
    if (comment?.trim()) {
      const adjustPrompt = `The following workout plan was generated:\n${JSON.stringify(recommendation, null, 2)}\n\nThe user requests the following adjustment: "${comment}"\n\nPlease return an updated plan in the same JSON format, incorporating the user's feedback. Keep the same structure.`;
      const messages: ChatMsg[] = [{ role: 'user', content: adjustPrompt }];
      const adjusted = await this.llmService.generateWithSystemPrompt(
        messages,
        'You are an expert fitness coach. Adjust the workout plan based on user feedback. Return valid JSON only.',
        { jsonMode: true },
      );
      const adjustedPlan = JSON.parse(adjusted) as SessionRecommendation;
      await this.sessionRepo.update(sessionId, { sessionPlanJson: adjustedPlan });
      return adjustedPlan;
    }

    await this.sessionRepo.update(sessionId, { sessionPlanJson: recommendation });
    return recommendation;
  }

  async updateSessionPlan(sessionId: string, exercises: SessionRecommendation['exercises']): Promise<WorkoutSession> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error('Session not found');

    const currentPlan = (session.sessionPlanJson ?? {}) as SessionRecommendation;
    const updatedPlan: SessionRecommendation = {
      ...currentPlan,
      exercises,
    };

    return this.sessionRepo.update(sessionId, { sessionPlanJson: updatedPlan });
  }

  async startSession(userId: string, dto: CreateSessionDto): Promise<WorkoutSession> {
    // 1. Auto-close timed-out sessions
    await this.autoCloseTimedOutSessions(userId);

    // 2. Check for active session (only if starting a training session, not planning)
    if (dto.status !== 'planning') {
      const activeSession = await this.sessionRepo.findActiveByUserId(userId);
      if (activeSession) {
        throw new Error('You already have an active session. Please complete or skip it first.');
      }
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

    const { exerciseId } = opts ?? {};

    if (exerciseId) {
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

    // No exerciseId — only acceptable if exerciseName provided (off-plan exercise)
    // We cannot guess which exercise the user is doing
    if (!opts?.exerciseName) {
      throw new Error('exerciseId is required to log a set. AI must identify the exercise being performed.');
    }

    // Off-plan exercise by name — try exact match first, fall back to embedding search
    const exerciseName = opts.exerciseName ?? '';
    let resolvedExerciseId: string | undefined;

    const exactMatches = await this.exerciseRepo.search(exerciseName, 1);
    const exactMatch = exactMatches.find(ex => ex.name.toLowerCase() === exerciseName.toLowerCase());
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

    const created = await this.sessionExerciseRepo.create(sessionId, {
      exerciseId: resolvedExerciseId,
      orderIndex: session.exercises.length,
    });
    await this.sessionExerciseRepo.update(created.id, { status: 'in_progress' });
    await this.sessionRepo.updateActivity(sessionId);
    return { exercise: { ...created, status: 'in_progress' } };
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
    if (inProgress) return this.sessionRepo.findByIdWithDetails(inProgress.id);

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
      // eslint-disable-next-line no-await-in-loop
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

  private async generateFreeformRecommendation(userId: string): Promise<SessionRecommendation> {
    const userEntity = await this.userRepo.getById(userId);
    if (!userEntity) throw new Error('User not found');

    const recentSessions = await this.sessionRepo.findRecentByUserIdWithDetails(userId, 5);

    const historySection = recentSessions.length
      ? recentSessions
          .map((s, i) => {
            const exList = s.exercises
              .map(ex => `  - ${ex.exercise?.name ?? ex.exerciseId}: ${ex.sets.length} sets`)
              .join('\n');
            return `${i + 1}. ${s.sessionKey ?? 'Custom'} (${s.status})\n${exList}`;
          })
          .join('\n')
      : 'No training history yet.';

    const prompt = `# CLIENT PROFILE
- Gender: ${userEntity.gender ?? 'N/A'}
- Age: ${userEntity.age ?? 'N/A'}
- Height: ${userEntity.height ?? 'N/A'} cm
- Weight: ${userEntity.weight ?? 'N/A'} kg
- Fitness Goal: ${userEntity.fitnessGoal ?? 'general fitness'}
- Fitness Level: ${userEntity.fitnessLevel ?? 'beginner'}

# TRAINING HISTORY
${historySection}

# TASK
The user has no structured workout plan yet. Design a balanced full-body workout session suitable for their profile. Pick 5-7 exercises. Use common exercise names (no IDs needed — set exerciseId to a placeholder UUID "00000000-0000-0000-0000-000000000000" for each).

**Response Format (JSON only):**
{
  "sessionKey": "freeform",
  "sessionName": "Full Body Workout",
  "reasoning": "Explanation...",
  "exercises": [
    { "exerciseId": "00000000-0000-0000-0000-000000000000", "exerciseName": "Exercise Name", "targetSets": 3, "targetReps": "8-12", "targetWeight": 0, "restSeconds": 90, "notes": "..." }
  ],
  "estimatedDuration": 45,
  "warnings": [],
  "modifications": []
}`;

    const messages: ChatMsg[] = [{ role: 'user', content: prompt }];
    const raw = await this.llmService.generateWithSystemPrompt(
      messages,
      'You are an expert fitness coach. Design a personalized workout session. Return valid JSON only.',
      { jsonMode: true },
    );

    return JSON.parse(raw) as SessionRecommendation;
  }

  private async autoCloseTimedOutSessions(userId: string): Promise<void> {
    const cutoffTime = new Date(Date.now() - SESSION_TIMEOUT_MS);
    await this.sessionRepo.autoCloseTimedOut(userId, cutoffTime);
  }
}
