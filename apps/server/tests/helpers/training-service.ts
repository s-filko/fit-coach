import { TrainingService } from '@domain/training/services/training.service';

import { ExerciseRepository } from '@infra/db/repositories/exercise.repository';
import { SessionExerciseRepository } from '@infra/db/repositories/session-exercise.repository';
import { SessionSetRepository } from '@infra/db/repositories/session-set.repository';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { WorkoutPlanRepository } from '@infra/db/repositories/workout-plan.repository';
import { WorkoutSessionRepository } from '@infra/db/repositories/workout-session.repository';

/**
 * The real TrainingService over the real repositories (the local fitcoach_test database) — the one
 * place integration tests wire it. Returns the repositories too: tests seed and read through them.
 * `sessionRepo` may be replaced (e.g. by a decorated repository that simulates a race).
 */
export function buildRealTrainingService(overrides: { sessionRepo?: WorkoutSessionRepository } = {}) {
  const userRepo = new DrizzleUserRepository();
  const exerciseRepo = new ExerciseRepository();
  const sessionRepo = overrides.sessionRepo ?? new WorkoutSessionRepository();
  const sessionExerciseRepo = new SessionExerciseRepository();
  const sessionSetRepo = new SessionSetRepository();
  const service = new TrainingService(
    new WorkoutPlanRepository(),
    sessionRepo,
    exerciseRepo,
    sessionExerciseRepo,
    sessionSetRepo,
    userRepo,
  );
  return { service, userRepo, exerciseRepo, sessionRepo, sessionExerciseRepo, sessionSetRepo };
}
