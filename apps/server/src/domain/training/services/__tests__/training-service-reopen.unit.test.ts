/**
 * `reopenLastSession` (BUG-053, stale-session-autoclose plan T2 / AC-SSA-2): the user's most
 * recent completed session returns to training — `status = in_progress`, `completed_at` and
 * `auto_close_reason` cleared, `reopened_at` stamped, `last_activity_at` untouched (sets logged
 * into it stay retro-dated to the session's last activity, BR-TRAINING-030). Refusals are typed
 * domain errors: an active session (INV-TRAINING-002) and no completed session at all.
 */
import { ActiveSessionExistsError, NoCompletedSessionError } from '@domain/training/errors';

import { createMocks, makeExerciseWithDetails, makeSession, makeSessionSet } from './training-service-test-support';

const LAST_ACTIVITY = new Date('2026-10-08T11:31:00.000Z');

/** A completed upper_a with one logged set — the shape reopenLastSession finds. */
const completedSession = () =>
  ({
    ...makeSession([makeExerciseWithDetails({ sets: [makeSessionSet()] })]),
    sessionKey: 'upper_a',
    status: 'completed' as const,
    completedAt: new Date('2026-10-08T11:32:00.000Z'),
    autoCloseReason: 'timeout' as const,
    lastActivityAt: LAST_ACTIVITY,
  }) as ReturnType<typeof makeSession>;

describe('TrainingService.reopenLastSession (BUG-053 T2, AC-SSA-2)', () => {
  it('reopens the most recent completed session: in_progress, completion fields cleared, reopened_at stamped, last_activity_at untouched', async () => {
    const { trainingService, mockSessionRepo } = createMocks();
    const completed = completedSession();
    mockSessionRepo.findTimedOut.mockResolvedValue([]);
    mockSessionRepo.findActiveByUserId.mockResolvedValue(null);
    mockSessionRepo.findLastCompletedByUserId.mockResolvedValue(completed);
    mockSessionRepo.update.mockImplementation(
      async (_id, updates) => ({ ...completed, ...updates }) as ReturnType<typeof makeSession>,
    );
    mockSessionRepo.findByIdWithDetails.mockResolvedValue({
      ...completed,
      status: 'in_progress',
      completedAt: null,
      autoCloseReason: null,
    });

    const result = await trainingService.reopenLastSession('user-1');

    expect(mockSessionRepo.update).toHaveBeenCalledTimes(1);
    expect(mockSessionRepo.update).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        status: 'in_progress',
        completedAt: null,
        autoCloseReason: null,
        reopenedAt: expect.any(Date),
      }),
    );
    // last_activity_at is deliberately not part of the write (BR-TRAINING-030).
    expect(mockSessionRepo.update.mock.calls[0]![1]).not.toHaveProperty('lastActivityAt');
    expect(result.status).toBe('in_progress');
    expect(result.autoCloseReason).toBeNull();
  });

  it('auto-closes timed-out sessions first, then refuses when one is still active (typed error)', async () => {
    const { trainingService, mockSessionRepo } = createMocks();
    mockSessionRepo.findTimedOut.mockResolvedValue([]);
    mockSessionRepo.findActiveByUserId.mockResolvedValue(completedSession()); // an in_progress one
    mockSessionRepo.autoCloseTimedOut.mockResolvedValue(1);

    await expect(trainingService.reopenLastSession('user-1')).rejects.toBeInstanceOf(ActiveSessionExistsError);
    // The refusal happened after the timeout sweep, not before it.
    expect(mockSessionRepo.autoCloseTimedOut).toHaveBeenCalledTimes(1);
    expect(mockSessionRepo.update).not.toHaveBeenCalled();
  });

  it('refuses with a typed error when the user has no completed session', async () => {
    const { trainingService, mockSessionRepo } = createMocks();
    mockSessionRepo.findTimedOut.mockResolvedValue([]);
    mockSessionRepo.findActiveByUserId.mockResolvedValue(null);
    mockSessionRepo.findLastCompletedByUserId.mockResolvedValue(null);

    await expect(trainingService.reopenLastSession('user-1')).rejects.toBeInstanceOf(NoCompletedSessionError);
    expect(mockSessionRepo.update).not.toHaveBeenCalled();
  });
});
