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

    // 2. Check for active session
    const activeSession = await this.sessionRepo.findActiveByUserId(userId);
    if (activeSession) {
      throw new Error('You already have an active session. Please complete or skip it first.');
    }

    // 3. Create new session
    const session = await this.sessionRepo.create(userId, dto);

    // 4. Start it immediately
    return this.sessionRepo.update(session.id, {
      status: 'in_progress',
      startedAt: new Date(),
    });
  }

  async addExerciseToSession(
    sessionId: string,
    dto: CreateSessionExerciseDto,
  ): Promise<SessionExercise> {
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

    // Create set
    const set = await this.sessionSetRepo.create(exerciseId, dto);

    // Update exercise status to in_progress if first set
    if (dto.setNumber === 1) {
      await this.sessionExerciseRepo.update(exerciseId, { status: 'in_progress' });
    }

    return set;
  }

  async completeSession(sessionId: string, durationMinutes?: number): Promise<WorkoutSession> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const completedAt = new Date();
    const duration =
      durationMinutes ??
      (session.startedAt
        ? Math.floor((completedAt.getTime() - session.startedAt.getTime()) / 60000)
        : null);

    return this.sessionRepo.complete(sessionId, completedAt, duration ?? 0);
  }

  async getTrainingHistory(userId: string, limit = 10): Promise<WorkoutSessionWithDetails[]> {
    return this.sessionRepo.findRecentByUserIdWithDetails(userId, limit);
  }

  async getSessionDetails(sessionId: string): Promise<WorkoutSessionWithDetails | null> {
    return this.sessionRepo.findByIdWithDetails(sessionId);
  }

  // --- Private helpers ---

  private async autoCloseTimedOutSessions(userId: string): Promise<void> {
    const cutoffTime = new Date(Date.now() - SESSION_TIMEOUT_MS);
    await this.sessionRepo.autoCloseTimedOut(userId, cutoffTime);
  }
}
