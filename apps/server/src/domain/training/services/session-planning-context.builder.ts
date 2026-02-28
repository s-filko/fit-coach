import type {
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports/repository.ports';
import type { WorkoutPlan, WorkoutSessionWithDetails } from '@domain/training/types';

/**
 * Context data for session planning phase
 * Provides LLM with user's training history and active plan
 */
export interface SessionPlanningContextData {
  activePlan: WorkoutPlan | null;
  recentSessions: WorkoutSessionWithDetails[];
  daysSinceLastWorkout: number | null;
}

/**
 * Builds rich context for session planning phase
 * Loads user's training history, active plan, and available exercises
 */
export class SessionPlanningContextBuilder {
  constructor(
    private readonly workoutPlanRepo: IWorkoutPlanRepository,
    private readonly workoutSessionRepo: IWorkoutSessionRepository,
  ) {}

  /**
   * Build complete context for session planning
   * @param userId - User ID to build context for
   * @param recentSessionsLimit - Number of recent sessions to include (default: 5)
   */
  async buildContext(userId: string, recentSessionsLimit = 5): Promise<SessionPlanningContextData> {
    const [activePlan, recentSessions] = await Promise.all([
      this.workoutPlanRepo.findActiveByUserId(userId),
      this.workoutSessionRepo.findRecentByUserIdWithDetails(userId, recentSessionsLimit),
    ]);

    let daysSinceLastWorkout: number | null = null;
    if (recentSessions.length > 0) {
      const [lastSession] = recentSessions;
      const lastWorkoutDate = lastSession.completedAt ?? lastSession.createdAt;
      const msPerDay = 1000 * 60 * 60 * 24;
      daysSinceLastWorkout = Math.floor((Date.now() - lastWorkoutDate.getTime()) / msPerDay);
    }

    return { activePlan, recentSessions, daysSinceLastWorkout };
  }

}
