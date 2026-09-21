/**
 * REPRODUCTION (RED) — AC-LSR-2 / BUG-025. Runs only via an explicit --testMatch; promoted to
 * format-exercise-summary.unit.test.ts when the fix lands.
 *
 * ensureCurrentExercise closes an exercise with no sets as 'skipped' and returns the summary
 * payload the log_set tool feeds to formatExerciseSummary. The tool result the model reads must
 * not claim the exercise was completed, nor ask for an RPE trend over an empty set list.
 * Live evidence: run ef6030d6, 2026-09-21 09:59:31.
 */
import type {
  IExerciseRepository,
  ISessionExerciseRepository,
  ISessionSetRepository,
  IWorkoutPlanRepository,
  IWorkoutSessionRepository,
} from '@domain/training/ports';
import { TrainingService } from '@domain/training/services/training.service';
import type { SessionExercise, SessionExerciseWithDetails, WorkoutSessionWithDetails } from '@domain/training/types';

import { formatExerciseSummary } from '../format-exercise-summary';

const SEATED_ID = 'd8794819-ffc6-4d08-8336-d9bedc4e554a';
const STANDING_ID = '9b39b2e2-6a32-4756-acbd-223d6c7e564b';

const makeExercise = (overrides: Partial<SessionExerciseWithDetails>): SessionExerciseWithDetails =>
  ({
    id: 'se-seated',
    sessionId: 'session-1',
    exerciseId: SEATED_ID,
    orderIndex: 0,
    status: 'in_progress',
    targetSets: 3,
    targetReps: '15',
    targetWeight: null,
    actualRepsRange: null,
    userFeedback: null,
    createdAt: new Date(),
    exercise: { id: SEATED_ID, name: 'Seated Calf Raise Machine' },
    sets: [],
    ...overrides,
  }) as unknown as SessionExerciseWithDetails;

/** Runs the real ensureCurrentExercise switch and returns what it wrote and what it handed back. */
async function switchAwayFrom(current: SessionExerciseWithDetails) {
  const next = makeExercise({ id: 'se-standing', exerciseId: STANDING_ID, status: 'pending', sets: [] });
  const session = {
    id: 'session-1',
    userId: 'user-1',
    status: 'in_progress',
    sessionPlanJson: null,
    exercises: [current, next],
  } as unknown as WorkoutSessionWithDetails;

  const sessionRepo = {
    findByIdWithDetails: jest.fn().mockResolvedValue(session),
    updateActivity: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IWorkoutSessionRepository>;
  const sessionExerciseRepo = {
    update: jest.fn().mockImplementation(async (_id: string, updates: object) => ({ ...updates }) as SessionExercise),
  } as unknown as jest.Mocked<ISessionExerciseRepository>;

  const service = new TrainingService(
    {} as IWorkoutPlanRepository,
    sessionRepo,
    { findById: jest.fn() } as unknown as IExerciseRepository,
    sessionExerciseRepo,
    {} as ISessionSetRepository,
    {} as never,
    {} as never,
  );

  const { autoCompleted } = await service.ensureCurrentExercise('session-1', { exerciseId: STANDING_ID });
  return { autoCompleted, sessionExerciseRepo };
}

describe('formatExerciseSummary — auto-complete of an exercise with 0 sets (BUG-025)', () => {
  it('control: the domain closes an exercise with no sets as skipped and hands back an empty summary', async () => {
    const { autoCompleted, sessionExerciseRepo } = await switchAwayFrom(makeExercise({ sets: [] }));

    expect(sessionExerciseRepo.update).toHaveBeenCalledWith('se-seated', { status: 'skipped' });
    expect(autoCompleted).toMatchObject({ exerciseName: 'Seated Calf Raise Machine', setsLogged: 0, sets: [] });
  });

  it('control: an exercise that has sets is still reported as completed', async () => {
    const { autoCompleted, sessionExerciseRepo } = await switchAwayFrom(
      makeExercise({
        sets: [
          {
            id: 's1',
            sessionExerciseId: 'se-seated',
            setNumber: 1,
            rpe: 7,
            setData: { type: 'strength', reps: 15, weight: 40, weightUnit: 'kg' },
          },
        ] as never,
      }),
    );

    expect(sessionExerciseRepo.update).toHaveBeenCalledWith('se-seated', { status: 'completed' });
    expect(formatExerciseSummary(autoCompleted!)).toContain("Exercise 'Seated Calf Raise Machine' completed.");
  });

  it('does not claim "completed" for an exercise the domain marked skipped', async () => {
    const { autoCompleted } = await switchAwayFrom(makeExercise({ sets: [] }));

    expect(formatExerciseSummary(autoCompleted!)).not.toMatch(/completed/i);
  });

  it('does not ask the model for an RPE trend over an empty set list', async () => {
    const { autoCompleted } = await switchAwayFrom(makeExercise({ sets: [] }));

    expect(formatExerciseSummary(autoCompleted!)).not.toMatch(/RPE/);
  });
});
