import type {
  IExerciseRepository,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports/repository.ports';
import type { WorkoutPlan, WorkoutSessionWithDetails } from '@domain/training/types';

/**
 * Context data for session planning phase
 * Provides LLM with user's training history and available resources
 */
export interface SessionPlanningContextData {
  // User's active workout plan (if any)
  activePlan: WorkoutPlan | null;
  // Recent training sessions (last N sessions)
  recentSessions: WorkoutSessionWithDetails[];
  // Total number of exercises available in catalog
  totalExercisesAvailable: number;
  // Days since last workout (null if never trained)
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
    private readonly exerciseRepo: IExerciseRepository,
  ) {}

  /**
   * Build complete context for session planning
   * @param userId - User ID to build context for
   * @param recentSessionsLimit - Number of recent sessions to include (default: 5)
   */
  async buildContext(userId: string, recentSessionsLimit = 5): Promise<SessionPlanningContextData> {
    // Load all data in parallel for performance
    const [activePlan, recentSessions, allExercises] = await Promise.all([
      this.workoutPlanRepo.findActiveByUserId(userId),
      this.workoutSessionRepo.findRecentByUserIdWithDetails(userId, recentSessionsLimit),
      this.exerciseRepo.findAll(),
    ]);

    // Calculate days since last workout
    let daysSinceLastWorkout: number | null = null;
    if (recentSessions.length > 0) {
      const [lastSession] = recentSessions;
      const lastWorkoutDate = lastSession.completedAt ?? lastSession.createdAt;
      const now = new Date();
      const diffMs = now.getTime() - lastWorkoutDate.getTime();
      const msPerDay = 1000 * 60 * 60 * 24;
      daysSinceLastWorkout = Math.floor(diffMs / msPerDay);
    }

    return {
      activePlan,
      recentSessions,
      totalExercisesAvailable: allExercises.length,
      daysSinceLastWorkout,
    };
  }

  /**
   * Format context data as text for LLM prompt
   * Converts structured data into human-readable format
   */
  formatForPrompt(context: SessionPlanningContextData): string {
    const lines: string[] = [];

    // Active plan info
    if (context.activePlan) {
      lines.push('=== Active Workout Plan ===');
      lines.push(`Name: ${context.activePlan.name}`);
      lines.push(`Goal: ${context.activePlan.planJson.goal}`);
      lines.push(`Training Style: ${context.activePlan.planJson.trainingStyle}`);
      lines.push(`Target Muscle Groups: ${context.activePlan.planJson.targetMuscleGroups.join(', ')}`);
      if (context.activePlan.planJson.sessionTemplates.length > 0) {
        lines.push(`Session Templates: ${context.activePlan.planJson.sessionTemplates.length}`);
      }
      lines.push('');
    } else {
      lines.push('=== No Active Plan ===');
      lines.push('User has no active workout plan.');
      lines.push('');
    }

    // Recent sessions
    if (context.recentSessions.length > 0) {
      lines.push('=== Recent Training History ===');
      lines.push(`Last workout: ${context.daysSinceLastWorkout ?? 'N/A'} days ago`);
      lines.push('');

      context.recentSessions.forEach((session, idx) => {
        const sessionDate = session.completedAt ?? session.createdAt;
        const [dateStr] = sessionDate.toISOString().split('T');
        const status = session.status === 'completed' ? '✓' : '○';

        lines.push(`${status} Session ${idx + 1} (${dateStr})`);
        if (session.sessionKey) {
          lines.push(`  Key: ${session.sessionKey}`);
        }
        if (session.durationMinutes) {
          lines.push(`  Duration: ${session.durationMinutes} min`);
        }
        if (session.exercises && session.exercises.length > 0) {
          lines.push(`  Exercises: ${session.exercises.length}`);
          session.exercises.forEach(ex => {
            const setsCount = ex.sets?.length ?? 0;
            lines.push(`    - ${ex.exercise.name} (${setsCount} sets)`);
          });
        }
        lines.push('');
      });
    } else {
      lines.push('=== No Training History ===');
      lines.push('User has not completed any workouts yet.');
      lines.push('');
    }

    // Available exercises
    lines.push('=== Exercise Catalog ===');
    lines.push(`Total exercises available: ${context.totalExercisesAvailable}`);
    lines.push('');

    return lines.join('\n');
  }
}
