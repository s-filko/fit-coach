/**
 * sessionLifecycleHandler tests (refactor-p3-run-context-commit Task 4, D-D):
 * BR-CONV-018 side effects — session activation on → training, completion of
 * a lingering session on leaving training, activeSessionId merge result.
 */
import type { PhaseTransitionCommitted } from '@domain/conversation/events';
import type { ITrainingService, IWorkoutSessionRepository } from '@domain/training/ports';

import { buildSessionLifecycleHandler } from '../session-lifecycle.handler';

function eventOf(overrides: Partial<PhaseTransitionCommitted>): PhaseTransitionCommitted {
  return {
    type: 'phase_transition_committed',
    userId: 'u1',
    runId: 'r1',
    from: 'session_planning',
    to: 'training',
    reason: null,
    activeSessionId: 's1',
    at: new Date('2026-09-18T10:00:00Z'),
    ...overrides,
  };
}

function makeDeps(sessionStatus: string | null) {
  const update = jest.fn(async () => ({}));
  const completeSession = jest.fn(async () => ({}));
  const trainingService = {
    getSessionDetails: async () => (sessionStatus ? { id: 's1', status: sessionStatus } : null),
    completeSession,
  } as unknown as ITrainingService;
  const workoutSessionRepo = { update } as unknown as IWorkoutSessionRepository;
  return { handler: buildSessionLifecycleHandler({ trainingService, workoutSessionRepo }), update, completeSession };
}

describe('sessionLifecycleHandler (BR-CONV-018, D-D)', () => {
  it('→ training activates a planning session and keeps the activeSessionId', async () => {
    const { handler, update } = makeDeps('planning');

    await expect(handler(eventOf({}))).resolves.toEqual({ activeSessionId: 's1' });
    expect(update).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'in_progress' }));
  });

  it('→ training with a non-planning session changes nothing', async () => {
    const { handler, update } = makeDeps('in_progress');

    await expect(handler(eventOf({}))).resolves.toEqual({ activeSessionId: 's1' });
    expect(update).not.toHaveBeenCalled();
  });

  it('leaving training completes a lingering in-progress session and clears the id', async () => {
    const { handler, completeSession } = makeDeps('in_progress');

    await expect(handler(eventOf({ from: 'training', to: 'chat' }))).resolves.toEqual({ activeSessionId: null });
    expect(completeSession).toHaveBeenCalledWith('s1');
  });

  it('leaving training with an already-completed session does not complete again', async () => {
    const { handler, completeSession } = makeDeps('completed');

    await expect(handler(eventOf({ from: 'training', to: 'chat' }))).resolves.toEqual({ activeSessionId: null });
    expect(completeSession).not.toHaveBeenCalled();
  });

  it('a missing session (deleted under us) still clears the id', async () => {
    const { handler, completeSession } = makeDeps(null);

    await expect(handler(eventOf({ from: 'training', to: 'chat' }))).resolves.toEqual({ activeSessionId: null });
    expect(completeSession).not.toHaveBeenCalled();
  });

  it('transitions without an active session touch nothing', async () => {
    const { handler, update, completeSession } = makeDeps('planning');

    await expect(handler(eventOf({ activeSessionId: null }))).resolves.toEqual({});
    expect(update).not.toHaveBeenCalled();
    expect(completeSession).not.toHaveBeenCalled();
  });
});
