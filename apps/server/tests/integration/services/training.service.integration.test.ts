import { TrainingService } from '@domain/training/services/training.service';

import { LLMService } from '@infra/ai/llm.service';
import { ExerciseRepository } from '@infra/db/repositories/exercise.repository';
import { SessionExerciseRepository } from '@infra/db/repositories/session-exercise.repository';
import { SessionSetRepository } from '@infra/db/repositories/session-set.repository';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { WorkoutPlanRepository } from '@infra/db/repositories/workout-plan.repository';
import { WorkoutSessionRepository } from '@infra/db/repositories/workout-session.repository';

import { createTestUserData } from '../../shared/test-factories';

/**
 * TrainingService Integration Tests — ADR-0011 hardening behaviors
 *
 * Tests the correction tools and auto-complete behavior against a real DB.
 * These tests cover the vertical slice that unit tests cannot reach:
 * real repository operations + service logic + DB state assertions.
 *
 * Each test creates its own user and session to stay isolated.
 * Requires: RUN_DB_TESTS=1
 */
describe('TrainingService – integration (ADR-0011)', () => {
  let service: TrainingService;
  let userRepo: DrizzleUserRepository;
  let exerciseRepo: ExerciseRepository;
  let sessionRepo: WorkoutSessionRepository;
  let sessionExerciseRepo: SessionExerciseRepository;
  let sessionSetRepo: SessionSetRepository;

  let benchPressId: string;
  let squatId: string;

  beforeAll(async () => {
    userRepo = new DrizzleUserRepository();
    exerciseRepo = new ExerciseRepository();
    sessionRepo = new WorkoutSessionRepository();
    sessionExerciseRepo = new SessionExerciseRepository();
    sessionSetRepo = new SessionSetRepository();

    service = new TrainingService(
      new WorkoutPlanRepository(),
      sessionRepo,
      exerciseRepo,
      sessionExerciseRepo,
      sessionSetRepo,
      userRepo,
      new LLMService(),
    );

    // Resolve exercise IDs from seed data (inserted in global test setup)
    const exercises = await exerciseRepo.findAll();
    const bench = exercises.find(e => e.name === 'Barbell Bench Press');
    const squat = exercises.find(e => e.name === 'Barbell Back Squat');

    if (!bench || !squat) {
      throw new Error('Seed exercises not found — run tests with RUN_DB_TESTS=1 and ensure schema is initialised');
    }

    benchPressId = bench.id;
    squatId = squat.id;
  });

  // ---------------------------------------------------------------------------
  // Helper: creates an isolated user + session + set(s) for each test
  // ---------------------------------------------------------------------------

  const setupSession = async (label: string) => {
    const user = await userRepo.create(createTestUserData({ username: `ts_int_${label}_${Date.now()}` }));
    const session = await service.startSession(user.id, {});
    return { userId: user.id, sessionId: session.id };
  };

  // ---------------------------------------------------------------------------
  // P2 — ensureCurrentExercise: auto-complete on exercise switch
  // ---------------------------------------------------------------------------

  describe('ensureCurrentExercise — auto-complete on switch (ADR-0011 Fix 1.3)', () => {
    it('should mark previous exercise as completed when switching to a different exerciseId with sets', async () => {
      const { sessionId } = await setupSession('autocomplete_with_sets');

      // Log a set for bench press → puts it in_progress
      await service.logSetWithContext(sessionId, {
        exerciseId: benchPressId,
        setData: { type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' },
      });

      // Switch to squat — bench press should be auto-completed
      const result = await service.ensureCurrentExercise(sessionId, { exerciseId: squatId });

      expect(result.autoCompleted).toBeDefined();
      expect(result.autoCompleted!.exerciseId).toBe(benchPressId);
      expect(result.autoCompleted!.setsLogged).toBe(1);

      // Verify in DB
      const details = await service.getSessionDetails(sessionId);
      const benchEx = details!.exercises.find(e => e.exerciseId === benchPressId);
      expect(benchEx!.status).toBe('completed');

      const squatEx = details!.exercises.find(e => e.exerciseId === squatId);
      expect(squatEx!.status).toBe('in_progress');
    });

    it('should mark previous exercise as skipped when switching with 0 sets', async () => {
      const { sessionId } = await setupSession('autocomplete_no_sets');

      // Open bench press without logging any sets
      await service.ensureCurrentExercise(sessionId, { exerciseId: benchPressId });

      // Switch to squat — bench press should be auto-skipped (0 sets)
      const result = await service.ensureCurrentExercise(sessionId, { exerciseId: squatId });

      expect(result.autoCompleted).toBeDefined();
      expect(result.autoCompleted!.setsLogged).toBe(0);

      const details = await service.getSessionDetails(sessionId);
      const benchEx = details!.exercises.find(e => e.exerciseId === benchPressId);
      expect(benchEx!.status).toBe('skipped');
    });
  });

  // ---------------------------------------------------------------------------
  // P3 — deleteLastSets: correction without creating phantom sets
  // ---------------------------------------------------------------------------

  describe('deleteLastSets — remove wrong sets from DB (ADR-0011 Fix 2.1)', () => {
    it('should delete the most recent set and reduce set count in DB', async () => {
      const { sessionId } = await setupSession('delete_sets');

      // Log 2 sets
      await service.logSetWithContext(sessionId, {
        exerciseId: benchPressId,
        setData: { type: 'strength', reps: 10, weight: 80, weightUnit: 'kg' },
      });
      await service.logSetWithContext(sessionId, {
        exerciseId: benchPressId,
        setData: { type: 'strength', reps: 8, weight: 82.5, weightUnit: 'kg' },
      });

      const beforeDetails = await service.getSessionDetails(sessionId);
      const beforeCount = beforeDetails!.exercises.find(e => e.exerciseId === benchPressId)!.sets.length;
      expect(beforeCount).toBe(2);

      // Delete last set
      const result = await service.deleteLastSets(sessionId, benchPressId, 1);

      expect(result.deletedSets).toHaveLength(1);
      expect(result.deletedSets[0].setNumber).toBe(2); // Most recent set deleted

      // Verify DB — only 1 set remains
      const afterDetails = await service.getSessionDetails(sessionId);
      const afterSets = afterDetails!.exercises.find(e => e.exerciseId === benchPressId)!.sets;
      expect(afterSets).toHaveLength(1);
      expect(afterSets[0].setNumber).toBe(1);
    });

    it('should throw when no sets exist to delete', async () => {
      const { sessionId } = await setupSession('delete_no_sets');

      // Open exercise without logging any sets
      await service.ensureCurrentExercise(sessionId, { exerciseId: benchPressId });

      await expect(service.deleteLastSets(sessionId, benchPressId, 1)).rejects.toThrow(/No sets found/);
    });
  });

  // ---------------------------------------------------------------------------
  // P3 — updateLastSet: correct wrong data without adding new set
  // ---------------------------------------------------------------------------

  describe('updateLastSet — correct set data in DB (ADR-0011 Fix 2.2)', () => {
    it('should update weight of the last set without adding a new row', async () => {
      const { sessionId } = await setupSession('update_set');

      // Log set with wrong weight
      await service.logSetWithContext(sessionId, {
        exerciseId: benchPressId,
        setData: { type: 'strength', reps: 10, weight: 70, weightUnit: 'kg' },
      });

      const beforeDetails = await service.getSessionDetails(sessionId);
      const beforeCount = beforeDetails!.exercises.find(e => e.exerciseId === benchPressId)!.sets.length;

      // Correct the weight
      const result = await service.updateLastSet(sessionId, benchPressId, { weight: 75 });

      expect(result.setNumber).toBe(1);
      expect((result.before.setData as { weight?: number }).weight).toBe(70);
      expect((result.after.setData as { weight?: number }).weight).toBe(75);

      // Verify DB — still 1 set, weight corrected
      const afterDetails = await service.getSessionDetails(sessionId);
      const afterSets = afterDetails!.exercises.find(e => e.exerciseId === benchPressId)!.sets;
      expect(afterSets).toHaveLength(beforeCount); // No new row added
      expect((afterSets[0].setData as { weight?: number }).weight).toBe(75);
    });

    it('should update RPE independently of setData', async () => {
      const { sessionId } = await setupSession('update_rpe');

      await service.logSetWithContext(sessionId, {
        exerciseId: benchPressId,
        setData: { type: 'strength', reps: 8, weight: 80, weightUnit: 'kg' },
        rpe: 7,
      });

      const result = await service.updateLastSet(sessionId, benchPressId, { rpe: 9 });

      expect(result.before.rpe).toBe(7);
      expect(result.after.rpe).toBe(9);
      // Weight unchanged
      expect((result.after.setData as { weight?: number }).weight).toBe(80);
    });
  });

  // ---------------------------------------------------------------------------
  // SessionSetRepository.deleteById (repository-level, gap noted in test plan)
  // ---------------------------------------------------------------------------

  describe('SessionSetRepository.deleteById (ADR-0011 repository addition)', () => {
    it('should remove the set row from DB', async () => {
      const { sessionId } = await setupSession('delete_by_id');

      await service.logSetWithContext(sessionId, {
        exerciseId: benchPressId,
        setData: { type: 'strength', reps: 5, weight: 90, weightUnit: 'kg' },
      });

      const details = await service.getSessionDetails(sessionId);
      const [set] = details!.exercises.find(e => e.exerciseId === benchPressId)!.sets;

      await sessionSetRepo.deleteById(set.id);

      const retrieved = await sessionSetRepo.findById(set.id);
      expect(retrieved).toBeNull();
    });

    it('should not throw when deleting a non-existent set id', async () => {
      await expect(sessionSetRepo.deleteById('00000000-0000-0000-0000-000000000000')).resolves.not.toThrow();
    });
  });
});
