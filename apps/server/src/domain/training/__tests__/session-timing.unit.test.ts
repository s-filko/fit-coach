/**
 * `autoCloseIdleSince` (BUG-053, stale-session-autoclose plan / INV-TRAINING-005): the one
 * place the idle moment of the lazy auto-close is computed — `max(last_activity_at,
 * reopened_at)` (with `lastActivityOf`'s fallback chain for the activity part): a session
 * returned by `reopen_workout` is idle from its reopening, not from the activity that preceded
 * the close.
 */
import { autoCloseIdleSince, SESSION_TIMEOUT_MS } from '../session-timing';

describe('autoCloseIdleSince (BUG-053, INV-TRAINING-005)', () => {
  it('measures from the last activity when it is present', () => {
    const createdAt = new Date('2026-10-05T09:00:00.000Z');
    const lastActivityAt = new Date('2026-10-08T08:00:00.000Z');

    expect(autoCloseIdleSince({ lastActivityAt, createdAt }).getTime()).toBe(lastActivityAt.getTime());
  });

  it('falls back to updatedAt, then createdAt, when lastActivityAt is absent', () => {
    const createdAt = new Date('2026-10-05T09:00:00.000Z');
    const updatedAt = new Date('2026-10-06T09:00:00.000Z');

    expect(autoCloseIdleSince({ updatedAt, createdAt }).getTime()).toBe(updatedAt.getTime());
    expect(autoCloseIdleSince({ createdAt }).getTime()).toBe(createdAt.getTime());
  });

  it('the timeout boundary is strict: exactly SESSION_TIMEOUT_MS of idle is not past it', () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    const exactlyIdle = new Date(now.getTime() - SESSION_TIMEOUT_MS);
    const justPast = new Date(exactlyIdle.getTime() - 1);
    const createdAt = new Date('2026-10-05T09:00:00.000Z');

    expect(now.getTime() - autoCloseIdleSince({ lastActivityAt: exactlyIdle, createdAt }).getTime()).toBe(
      SESSION_TIMEOUT_MS,
    );
    expect(now.getTime() - autoCloseIdleSince({ lastActivityAt: justPast, createdAt }).getTime()).toBeGreaterThan(
      SESSION_TIMEOUT_MS,
    );
  });

  it('measures from the reopening when it is later than the last activity (a just-reopened workout is fresh)', () => {
    const createdAt = new Date('2026-10-04T09:00:00.000Z');
    const lastActivityAt = new Date('2026-10-04T11:31:00.000Z');
    const reopenedAt = new Date('2026-10-08T15:00:00.000Z');

    expect(autoCloseIdleSince({ lastActivityAt, createdAt, reopenedAt }).getTime()).toBe(reopenedAt.getTime());
  });

  it('measures from the last activity when the reopening is earlier (a set was logged after the reopen)', () => {
    const createdAt = new Date('2026-10-04T09:00:00.000Z');
    const lastActivityAt = new Date('2026-10-08T16:00:00.000Z');
    const reopenedAt = new Date('2026-10-08T15:00:00.000Z');

    expect(autoCloseIdleSince({ lastActivityAt, createdAt, reopenedAt }).getTime()).toBe(lastActivityAt.getTime());
  });

  it('no reopening (null or absent) — the last activity, as in T1', () => {
    const createdAt = new Date('2026-10-05T09:00:00.000Z');
    const lastActivityAt = new Date('2026-10-08T08:00:00.000Z');

    expect(autoCloseIdleSince({ lastActivityAt, createdAt, reopenedAt: null }).getTime()).toBe(
      lastActivityAt.getTime(),
    );
    expect(autoCloseIdleSince({ lastActivityAt, createdAt }).getTime()).toBe(lastActivityAt.getTime());
  });
});
