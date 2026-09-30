import { ExerciseRepository } from '../../../src/infra/db/repositories/exercise.repository';
import { WorkoutPlanRepository } from '../../../src/infra/db/repositories/workout-plan.repository';
import { WorkoutSessionRepository } from '../../../src/infra/db/repositories/workout-session.repository';
import { SessionExerciseRepository } from '../../../src/infra/db/repositories/session-exercise.repository';
import { SessionSetRepository } from '../../../src/infra/db/repositories/session-set.repository';
import { DrizzleUserRepository } from '../../../src/infra/db/repositories/user.repository';
import { createTestUserData } from '../../shared/test-factories';

/**
 * Training Repositories Integration Tests
 * Tests real database operations for training domain
 */
describe('Training Repositories – integration', () => {
  let exerciseRepo: ExerciseRepository;
  let planRepo: WorkoutPlanRepository;
  let sessionRepo: WorkoutSessionRepository;
  let exerciseSessionRepo: SessionExerciseRepository;
  let setRepo: SessionSetRepository;
  let userRepo: DrizzleUserRepository;
  let testUserId: string;

  beforeAll(async () => {
    // Initialize repositories (schema and seed are handled by global setup)
    exerciseRepo = new ExerciseRepository();
    planRepo = new WorkoutPlanRepository();
    sessionRepo = new WorkoutSessionRepository();
    exerciseSessionRepo = new SessionExerciseRepository();
    setRepo = new SessionSetRepository();
    userRepo = new DrizzleUserRepository();

    // Create test user
    const userData = createTestUserData({
      username: 'training_test_user',
      firstName: 'Training',
      lastName: 'Tester',
    });
    const user = await userRepo.create(userData);
    testUserId = user.id;
  });

  describe('ExerciseRepository', () => {
    it('should find exercises by muscle group', async () => {
      // Act
      const exercises = await exerciseRepo.findByMuscleGroup('chest');

      // Assert
      expect(exercises.length).toBeGreaterThan(0);
      expect(exercises[0]).toHaveProperty('id');
      expect(exercises[0]).toHaveProperty('name');
      expect(exercises[0]).toHaveProperty('category');
    });

    it('should find exercise with muscle groups', async () => {
      // Arrange - get any exercise first
      const allExercises = await exerciseRepo.findAll();
      expect(allExercises.length).toBeGreaterThan(0);
      const exerciseId = allExercises[0].id;

      // Act
      const exercise = await exerciseRepo.findByIdWithMuscles(exerciseId);

      // Assert
      expect(exercise).toBeDefined();
      expect(exercise?.id).toBe(exerciseId);
      expect(exercise?.muscleGroups).toBeDefined();
      expect(Array.isArray(exercise?.muscleGroups)).toBe(true);
    });

    it('should search exercises by name', async () => {
      // Act
      const exercises = await exerciseRepo.search('bench');

      // Assert
      expect(exercises.length).toBeGreaterThan(0);
      expect(exercises[0].name.toLowerCase()).toContain('bench');
    });
  });

  describe('WorkoutPlanRepository', () => {
    it('should create and retrieve workout plan', async () => {
      // Arrange
      const planData = {
        name: 'Test Upper/Lower Split',
        planJson: {
          goal: 'Muscle gain, 4-day split',
          trainingStyle: 'Progressive overload',
          targetMuscleGroups: ['chest' as const, 'back_lats' as const, 'quads' as const],
          recoveryGuidelines: {
            majorMuscleGroups: { minRestDays: 2, maxRestDays: 4 },
            smallMuscleGroups: { minRestDays: 1, maxRestDays: 3 },
            highIntensity: { minRestDays: 3 },
            customRules: [],
          },
          sessionTemplates: [],
          progressionRules: ['Increase weight by 2.5kg when all sets completed'],
        },
        status: 'active' as const,
      };

      // Act
      const plan = await planRepo.create(testUserId, planData);
      const retrieved = await planRepo.findById(plan.id);

      // Assert
      expect(plan.id).toBeDefined();
      expect(plan.name).toBe('Test Upper/Lower Split');
      expect(plan.status).toBe('active');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(plan.id);
    });

    it('should find active plan by user', async () => {
      // Act
      const activePlan = await planRepo.findActiveByUserId(testUserId);

      // Assert
      expect(activePlan).toBeDefined();
      expect(activePlan?.userId).toBe(testUserId);
      expect(activePlan?.status).toBe('active');
    });
  });

  describe('WorkoutSessionRepository', () => {
    let planId: string;

    beforeAll(async () => {
      // Create a plan for session tests
      const plan = await planRepo.create(testUserId, {
        name: 'Session Test Plan',
        planJson: {
          goal: 'Test',
          trainingStyle: 'Test style',
          targetMuscleGroups: [],
          recoveryGuidelines: {
            majorMuscleGroups: { minRestDays: 2, maxRestDays: 4 },
            smallMuscleGroups: { minRestDays: 1, maxRestDays: 3 },
            highIntensity: { minRestDays: 3 },
            customRules: [],
          },
          sessionTemplates: [],
          progressionRules: [],
        },
        status: 'active' as const,
      });
      planId = plan.id;
    });

    it('should create and retrieve session', async () => {
      // Arrange
      const sessionData = {
        planId,
        sessionKey: 'upper_a',
      };

      // Act
      const session = await sessionRepo.create(testUserId, sessionData);
      const retrieved = await sessionRepo.findById(session.id);

      // Assert
      expect(session.id).toBeDefined();
      expect(session.userId).toBe(testUserId);
      expect(session.planId).toBe(planId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(session.id);
    });

    it('should start session and update status', async () => {
      // Arrange
      const session = await sessionRepo.create(testUserId, {
        planId,
      });

      // Act
      const updated = await sessionRepo.update(session.id, {
        status: 'in_progress',
        startedAt: new Date(),
      });

      // Assert
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('in_progress');
      expect(updated?.startedAt).toBeDefined();

      // INV-TRAINING-002: the user has at most one in_progress session (partial unique index) —
      // close this one so the later tests sharing testUserId can open theirs.
      await sessionRepo.update(session.id, { status: 'skipped' });
    });

    it('should complete session with duration', async () => {
      // Arrange
      const session = await sessionRepo.create(testUserId, {
        planId,
      });
      await sessionRepo.update(session.id, {
        status: 'in_progress',
        startedAt: new Date(),
      });

      // Act
      const completed = await sessionRepo.complete(session.id, new Date(), 45);

      // Assert
      expect(completed).toBeDefined();
      expect(completed?.status).toBe('completed');
      expect(completed?.completedAt).toBeDefined();
      expect(completed?.durationMinutes).toBe(45);
    });

    it('should find recent sessions by user', async () => {
      // Act
      const sessions = await sessionRepo.findRecentByUserId(testUserId, 5);

      // Assert
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions[0].userId).toBe(testUserId);
    });

    it('should find active session by user', async () => {
      // Arrange - create an active session
      const session = await sessionRepo.create(testUserId, {
        planId,
      });
      await sessionRepo.update(session.id, {
        status: 'in_progress',
        startedAt: new Date(),
      });

      // Act
      const activeSession = await sessionRepo.findActiveByUserId(testUserId);

      // Assert
      expect(activeSession).toBeDefined();
      expect(activeSession?.status).toBe('in_progress');
      expect(activeSession?.userId).toBe(testUserId);
    });
  });

  describe('SessionExerciseRepository', () => {
    let sessionId: string;
    let exerciseId: string;

    beforeAll(async () => {
      // Create session for exercise tests
      const plan = await planRepo.findActiveByUserId(testUserId);
      const session = await sessionRepo.create(testUserId, {
        planId: plan!.id,
      });
      sessionId = session.id;

      // Get an exercise
      const exercises = await exerciseRepo.findAll();
      exerciseId = exercises[0].id;
    });

    it('should create and retrieve session exercise', async () => {
      // Arrange
      const exerciseData = {
        exerciseId,
        orderIndex: 0,
        targetSets: 4,
        targetReps: '8-10',
      };

      // Act
      const sessionExercise = await exerciseSessionRepo.create(sessionId, exerciseData);
      const retrieved = await exerciseSessionRepo.findById(sessionExercise.id);

      // Assert
      expect(sessionExercise.id).toBeDefined();
      expect(sessionExercise.sessionId).toBe(sessionId);
      expect(sessionExercise.exerciseId).toBe(exerciseId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(sessionExercise.id);
    });

    it('should find exercises by session', async () => {
      // Act
      const exercises = await exerciseSessionRepo.findBySessionId(sessionId);

      // Assert
      expect(Array.isArray(exercises)).toBe(true);
      expect(exercises.length).toBeGreaterThan(0);
      expect(exercises[0].sessionId).toBe(sessionId);
    });
  });

  describe('SessionSetRepository', () => {
    let sessionExerciseId: string;

    beforeAll(async () => {
      // Create session exercise for set tests
      const plan = await planRepo.findActiveByUserId(testUserId);
      const session = await sessionRepo.create(testUserId, {
        planId: plan!.id,
      });
      const exercises = await exerciseRepo.findAll();
      const sessionExercise = await exerciseSessionRepo.create(session.id, {
        exerciseId: exercises[0].id,
        orderIndex: 0,
      });
      sessionExerciseId = sessionExercise.id;
    });

    it('should create and retrieve strength set', async () => {
      // Arrange
      const setData = {
        setNumber: 1,
        setData: {
          type: 'strength' as const,
          reps: 10,
          weight: 50,
          weightUnit: 'kg' as const,
        },
        rpe: 7,
      };

      // Act
      const set = await setRepo.create(sessionExerciseId, setData);
      const retrieved = await setRepo.findById(set.id);

      // Assert
      expect(set.id).toBeDefined();
      expect(set.sessionExerciseId).toBe(sessionExerciseId);
      expect(set.setNumber).toBe(1);
      expect(set.setData.type).toBe('strength');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(set.id);
    });

    it('should create cardio distance set', async () => {
      // Arrange
      const setData = {
        setNumber: 2,
        setData: {
          type: 'cardio_distance' as const,
          distance: 5,
          distanceUnit: 'km' as const,
          duration: 1800, // 30 minutes in seconds
        },
      };

      // Act
      const set = await setRepo.create(sessionExerciseId, setData);

      // Assert
      expect(set.setData.type).toBe('cardio_distance');
      if (set.setData.type === 'cardio_distance') {
        expect(set.setData.distance).toBe(5);
        expect(set.setData.duration).toBe(1800);
      }
    });

    it('should find sets by exercise', async () => {
      // Act
      const sets = await setRepo.findByExerciseId(sessionExerciseId);

      // Assert
      expect(Array.isArray(sets)).toBe(true);
      expect(sets.length).toBeGreaterThan(0);
      expect(sets[0].sessionExerciseId).toBe(sessionExerciseId);
    });
  });

  /**
   * B3 (close-out review, set-kind plan D6, AC-SK-5): real-DB coverage of the window/dedupe/
   * exclusion rules `distinctRecentPlaces` implements over Postgres — a mocked repository cannot
   * exercise the actual SQL predicate (real-workout EXISTS join, NULL filter, ORDER BY + LIMIT).
   * Each test uses its own user so accumulated sessions never leak across assertions.
   */
  describe('WorkoutSessionRepository.distinctRecentPlaces', () => {
    let placesExerciseId: string;

    beforeAll(async () => {
      const exercises = await exerciseRepo.findAll();
      placesExerciseId = exercises[0].id;
    });

    async function newPlacesUser(username: string): Promise<string> {
      const user = await userRepo.create(createTestUserData({ username, firstName: 'Places', lastName: 'Tester' }));
      return user.id;
    }

    /** A completed session with >= 1 set (the "real workout" predicate) and the given place/time. */
    async function realWorkout(userId: string, place: string | null, completedAt: Date): Promise<void> {
      const session = await sessionRepo.create(userId, place ? { place } : {});
      const sessionExercise = await exerciseSessionRepo.create(session.id, {
        exerciseId: placesExerciseId,
        orderIndex: 0,
      });
      await setRepo.create(sessionExercise.id, {
        setData: { type: 'strength', reps: 5, weight: 20, weightUnit: 'kg' },
      });
      await sessionRepo.update(session.id, { status: 'in_progress', startedAt: completedAt });
      await sessionRepo.complete(session.id, completedAt, 30);
    }

    it('excludes NULL places and returns the distinct places within the window, newest first', async () => {
      const userId = await newPlacesUser('places_null_test_user');
      await realWorkout(userId, 'Gym A', new Date('2026-01-01T10:00:00Z'));
      await realWorkout(userId, null, new Date('2026-01-02T10:00:00Z'));
      await realWorkout(userId, 'Gym B', new Date('2026-01-03T10:00:00Z'));

      const places = await sessionRepo.distinctRecentPlaces(userId, 10);

      expect(places).toEqual(['Gym B', 'Gym A']);
    });

    it('dedupes AFTER the window, not before — a place pushed outside the window by newer ones drops off', async () => {
      const userId = await newPlacesUser('places_window_test_user');
      // Oldest → newest: A, B, A. With limit 3 both places are within the window, deduped to two.
      await realWorkout(userId, 'Gym A', new Date('2026-02-01T10:00:00Z'));
      await realWorkout(userId, 'Gym B', new Date('2026-02-02T10:00:00Z'));
      await realWorkout(userId, 'Gym A', new Date('2026-02-03T10:00:00Z'));

      expect(await sessionRepo.distinctRecentPlaces(userId, 3)).toEqual(['Gym A', 'Gym B']);
      // limit 1: only the newest row (Gym A) is in the window — Gym B never enters the dedupe set.
      expect(await sessionRepo.distinctRecentPlaces(userId, 1)).toEqual(['Gym A']);
    });

    it('ignores non-real workouts — no sets logged, or not completed — even when they carry a place', async () => {
      const userId = await newPlacesUser('places_non_real_test_user');
      await realWorkout(userId, 'Gym A', new Date('2026-03-01T10:00:00Z'));

      // A session with a place but zero sets — completed, but not a "real" workout (BUG-031 rule).
      const emptySession = await sessionRepo.create(userId, { place: 'Gym C' });
      await sessionRepo.update(emptySession.id, { status: 'in_progress', startedAt: new Date('2026-03-02T10:00:00Z') });
      await sessionRepo.complete(emptySession.id, new Date('2026-03-02T10:00:00Z'), 5);

      // A session with a place and a set, but never completed — still in_progress.
      const openSession = await sessionRepo.create(userId, { place: 'Gym D' });
      const openExercise = await exerciseSessionRepo.create(openSession.id, {
        exerciseId: placesExerciseId,
        orderIndex: 0,
      });
      await setRepo.create(openExercise.id, { setData: { type: 'strength', reps: 5, weight: 20, weightUnit: 'kg' } });
      await sessionRepo.update(openSession.id, { status: 'in_progress', startedAt: new Date('2026-03-03T10:00:00Z') });

      const places = await sessionRepo.distinctRecentPlaces(userId, 10);

      expect(places).toEqual(['Gym A']);

      // Close the still-open session so it never collides with INV-TRAINING-002 in a later test.
      await sessionRepo.update(openSession.id, { status: 'skipped' });
    });
  });
});
