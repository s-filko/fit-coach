/**
 * REPRODUCTION (RED) — AC-LSR-2 / BUG-025. Runs only via an explicit --testMatch; promoted to
 * format-exercise-summary.unit.test.ts when the fix lands.
 *
 * ensureCurrentExercise closes an exercise with no sets as 'skipped' and returns the summary
 * payload the log_set tool feeds to formatExerciseSummary. The tool result the model reads must
 * not claim the exercise was completed, nor ask for an RPE trend over an empty set list.
 * Live evidence: run ef6030d6, 2026-09-21 09:59:31.
 *
 * The domain half (0 sets → 'skipped') is proven by training-service-hardening.unit.test.ts; each
 * probe below only re-reads the status the domain wrote, in the same test, so a failure is
 * attributable to the TEXT and not to the classification.
 */
import {
  createMocks,
  makeExerciseWithDetails,
  makeSession,
} from '@domain/training/services/__tests__/training-service-test-support';
import type { SessionExercise } from '@domain/training/types';

import { formatExerciseSummary } from '../format-exercise-summary';

/** The seated calf raise the user abandoned with no sets logged, then a switch to the standing one. */
async function switchAwayFromEmptyExercise() {
  const { trainingService, mockSessionRepo, mockSessionExerciseRepo } = createMocks();
  const base = makeExerciseWithDetails();
  const seated = makeExerciseWithDetails({
    id: 'se-seated',
    status: 'in_progress',
    targetSets: 3,
    targetReps: '15',
    exercise: { ...base.exercise, name: 'Seated Calf Raise Machine' },
    sets: [],
  });
  const standing = makeExerciseWithDetails({
    id: 'se-standing',
    exerciseId: '9b39b2e2-6a32-4756-acbd-223d6c7e564b',
    status: 'pending',
  });
  mockSessionRepo.findByIdWithDetails.mockResolvedValue(makeSession([seated, standing]));
  mockSessionExerciseRepo.update.mockImplementation(async (_id, updates) => ({ ...updates }) as SessionExercise);

  const { autoCompleted } = await trainingService.ensureCurrentExercise('session-1', {
    exerciseId: standing.exerciseId,
  });
  // Same-test guard: the domain really handed over a skipped, empty exercise.
  expect(mockSessionExerciseRepo.update).toHaveBeenCalledWith('se-seated', { status: 'skipped' });
  return formatExerciseSummary(autoCompleted!);
}

describe('formatExerciseSummary — auto-complete of an exercise with 0 sets (BUG-025)', () => {
  it('does not claim "completed" for an exercise the domain marked skipped', async () => {
    expect(await switchAwayFromEmptyExercise()).not.toMatch(/completed/i);
  });

  it('does not ask the model for an RPE trend over an empty set list', async () => {
    expect(await switchAwayFromEmptyExercise()).not.toMatch(/RPE/);
  });
});
