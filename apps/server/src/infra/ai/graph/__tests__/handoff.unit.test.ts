/**
 * isAcceptedHandoff (transition-handoff plan close-out review, Blocking 1):
 * the ONE predicate tool-executor.ts and commit.node.ts both call, so they
 * can never disagree about what counts as an accepted same-run hand-off.
 */
import { isAcceptedHandoff } from '../handoff';

const TRAINING_TARGET = new Set(['training' as const]);

describe('isAcceptedHandoff', () => {
  it('accepts a valid transition to a hand-off target when the run has not hopped yet', () => {
    expect(
      isAcceptedHandoff(TRAINING_TARGET, 'session_planning', 's-1', { toPhase: 'training', reason: 'x' }, false),
    ).toBe(true);
  });

  it('close-out Blocking 1: rejects an otherwise-valid hand-off when the run has ALREADY hopped once', () => {
    expect(
      isAcceptedHandoff(TRAINING_TARGET, 'session_planning', 's-1', { toPhase: 'training', reason: 'x' }, true),
    ).toBe(false);
  });

  it('rejects when the target is not in handoffTargets', () => {
    expect(isAcceptedHandoff(new Set(), 'session_planning', 's-1', { toPhase: 'training', reason: 'x' }, false)).toBe(
      false,
    );
  });

  it('rejects when evaluateTransition would block it (no active session for training)', () => {
    expect(
      isAcceptedHandoff(TRAINING_TARGET, 'session_planning', null, { toPhase: 'training', reason: 'x' }, false),
    ).toBe(false);
  });

  it('rejects when evaluateTransition would block it (target not in the matrix for this phase)', () => {
    expect(isAcceptedHandoff(TRAINING_TARGET, 'chat', 's-1', { toPhase: 'training', reason: 'x' }, false)).toBe(false);
  });

  it('rejects when there is no pending transition', () => {
    expect(isAcceptedHandoff(TRAINING_TARGET, 'session_planning', 's-1', null, false)).toBe(false);
    expect(isAcceptedHandoff(TRAINING_TARGET, 'session_planning', 's-1', undefined, false)).toBe(false);
  });

  it('rejects when phase is undefined (a test fixture that never touches a hand-off target)', () => {
    expect(isAcceptedHandoff(TRAINING_TARGET, undefined, 's-1', { toPhase: 'training', reason: 'x' }, false)).toBe(
      false,
    );
  });
});
