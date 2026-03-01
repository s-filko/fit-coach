import type { LLMService } from '@domain/ai/ports';
import type {
  IExerciseRepository,
  ISessionExerciseRepository,
  ISessionSetRepository,
  ITrainingService,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import type {
  CreateSessionDto,
  CreateSessionExerciseDto,
  CreateSessionSetDto,
  SessionExercise,
  SessionRecommendation,
  SessionSet,
  SetData,
  UserProfile,
  WorkoutSession,
  WorkoutSessionWithDetails,
} from '@domain/training/types';
import type { ChatMsg, UserRepository } from '@domain/user/ports';

import { buildSessionRecommendationPrompt } from './prompts/session-recommendation.prompt';

const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

export class TrainingService implements ITrainingService {
  constructor(
    private workoutPlanRepo: IWorkoutPlanRepository,
    private sessionRepo: IWorkoutSessionRepository,
    private exerciseRepo: IExerciseRepository,
    private sessionExerciseRepo: ISessionExerciseRepository,
    private sessionSetRepo: ISessionSetRepository,
    private userRepo: UserRepository,
    private llmService: LLMService,
  ) {}

  async getNextSessionRecommendation(userId: string): Promise<SessionRecommendation> {
    // 1. Auto-close timed-out sessions before analyzing history
    await this.autoCloseTimedOutSessions(userId);

    // 2. Get user profile
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

  async addExerciseToSession(sessionId: string, dto: CreateSessionExerciseDto): Promise<SessionExercise> {
    // Update session activity
    await this.sessionRepo.updateActivity(sessionId);

    // Create exercise
    return this.sessionExerciseRepo.create(sessionId, dto);
  }

  async logSet(exerciseId: string, dto: CreateSessionSetDto): Promise<SessionSet> {
    // Get exercise to find session
    const exercise = await this.sessionExerciseRepo.findById(exerciseId);
    if (!exercise) {
      throw new Error('Session exercise not found');
    }

    // Update session activity
    await this.sessionRepo.updateActivity(exercise.sessionId);

    // Create set — setNumber computed atomically in DB
    const set = await this.sessionSetRepo.create(exerciseId, dto);

    // Mark exercise as in_progress on first set
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
   */
  async ensureCurrentExercise(
    sessionId: string,
    opts?: { exerciseId?: number; exerciseName?: string },
  ): Promise<SessionExercise> {
    const session = await this.sessionRepo.findByIdWithDetails(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const { exerciseId } = opts ?? {};

    if (exerciseId) {
      // Check if this exercise already exists in the session
      const existing = session.exercises.find(ex => ex.exerciseId === exerciseId);
      if (existing) {
        if (existing.status !== 'in_progress') {
          await this.sessionExerciseRepo.update(existing.id, { status: 'in_progress' });
        }
        return { ...existing, status: 'in_progress' };
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
      await this.sessionRepo.updateActivity(sessionId);
      return { ...created, status: 'in_progress' };
    }

    // No exerciseId — only acceptable if exerciseName provided (off-plan exercise)
    // We cannot guess which exercise the user is doing
    if (!opts?.exerciseName) {
      throw new Error('exerciseId is required to log a set. AI must identify the exercise being performed.');
    }

    // Off-plan exercise by name only — find by name in DB first
    const allExercises = await this.exerciseRepo.findAll();
    const matchByName = allExercises.find(ex => ex.name.toLowerCase() === (opts.exerciseName ?? '').toLowerCase());

    const resolvedExerciseId = matchByName?.id;
    if (!resolvedExerciseId) {
      throw new Error(`Exercise "${opts.exerciseName}" not found in DB. Cannot log set for unknown exercise.`);
    }

    const created = await this.sessionExerciseRepo.create(sessionId, {
      exerciseId: resolvedExerciseId,
      orderIndex: session.exercises.length,
    });
    await this.sessionExerciseRepo.update(created.id, { status: 'in_progress' });
    await this.sessionRepo.updateActivity(sessionId);
    return { ...created, status: 'in_progress' };
  }

  async completeSession(sessionId: string, durationMinutes?: number): Promise<WorkoutSession> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const completedAt = new Date();
    const duration =
      durationMinutes ??
      (session.startedAt ? Math.floor((completedAt.getTime() - session.startedAt.getTime()) / 60000) : null);

    return this.sessionRepo.complete(sessionId, completedAt, duration ?? 0);
  }

  async skipSession(sessionId: string): Promise<WorkoutSession> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return this.sessionRepo.update(sessionId, { status: 'skipped' });
  }

  async getTrainingHistory(userId: string, limit = 10): Promise<WorkoutSessionWithDetails[]> {
    return this.sessionRepo.findRecentByUserIdWithDetails(userId, limit);
  }

  async getSessionDetails(sessionId: string): Promise<WorkoutSessionWithDetails | null> {
    return this.sessionRepo.findByIdWithDetails(sessionId);
  }

  /**
   * Start next pending exercise in the session
   * Marks the first pending exercise as in_progress
   * @returns The started exercise or null if no pending exercises
   */
  async startNextExercise(sessionId: string): Promise<SessionExercise | null> {
    // Get session with exercises
    const session = await this.sessionRepo.findByIdWithDetails(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Find first pending exercise
    const nextExercise = session.exercises.find(ex => ex.status === 'pending');
    if (!nextExercise) {
      return null; // No more pending exercises
    }

    // Mark as in_progress
    await this.sessionExerciseRepo.update(nextExercise.id, { status: 'in_progress' });

    // Update session activity
    await this.sessionRepo.updateActivity(sessionId);

    return { ...nextExercise, status: 'in_progress' };
  }

  /**
   * Skip the current in_progress exercise
   * Marks it as skipped and moves to next
   */
  async skipCurrentExercise(sessionId: string, reason?: string): Promise<void> {
    // Get session with exercises
    const session = await this.sessionRepo.findByIdWithDetails(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Find current in_progress exercise
    const currentExercise = session.exercises.find(ex => ex.status === 'in_progress');
    if (!currentExercise) {
      throw new Error('No exercise currently in progress');
    }

    // Mark as skipped, persisting reason as userFeedback
    await this.sessionExerciseRepo.update(currentExercise.id, {
      status: 'skipped',
      userFeedback: reason ?? null,
    });

    // Update session activity
    await this.sessionRepo.updateActivity(sessionId);
  }

  /**
   * Complete the current in_progress exercise
   * Marks it as completed
   */
  async completeCurrentExercise(sessionId: string): Promise<void> {
    // Get session with exercises
    const session = await this.sessionRepo.findByIdWithDetails(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Find current in_progress exercise
    const currentExercise = session.exercises.find(ex => ex.status === 'in_progress');
    if (!currentExercise) {
      throw new Error('No exercise currently in progress');
    }

    // Mark as completed
    await this.sessionExerciseRepo.update(currentExercise.id, {
      status: 'completed',
    });

    // Update session activity
    await this.sessionRepo.updateActivity(sessionId);
  }

  async logSetWithContext(
    sessionId: string,
    opts: {
      exerciseId?: number;
      exerciseName?: string;
      setData: SetData;
      rpe?: number;
      feedback?: string;
    },
  ): Promise<{ set: SessionSet; setNumber: number }> {
    const sessionExercise = await this.ensureCurrentExercise(sessionId, {
      exerciseId: opts.exerciseId,
      exerciseName: opts.exerciseName,
    });

    const set = await this.logSet(sessionExercise.id, {
      setData: opts.setData,
      rpe: opts.rpe,
      userFeedback: opts.feedback,
    });

    return { set, setNumber: set.setNumber };
  }

  // --- Private helpers ---

  private async autoCloseTimedOutSessions(userId: string): Promise<void> {
    const cutoffTime = new Date(Date.now() - SESSION_TIMEOUT_MS);
    await this.sessionRepo.autoCloseTimedOut(userId, cutoffTime);
  }
}
