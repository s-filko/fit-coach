/**
 * `autoCloseIdleSince` (BUG-053, stale-session-autoclose plan T1 / INV-TRAINING-005): the one
 * place the idle moment of the lazy auto-close is computed — the last activity (with
 * `lastActivityOf`'s fallback chain). A finished workout is edited in place (T5), never
 * reopened, so there is no other base.
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
});
