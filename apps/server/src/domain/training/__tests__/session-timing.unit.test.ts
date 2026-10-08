/**
 * `isStale` (BUG-053, stale-session-autoclose plan T1 / INV-TRAINING-005): the one test of
 * "idle longer than the timeout", measured from the last activity (with `lastActivityOf`'s
 * fallback chain) — used by the retro-dating rule and by the stale-session close in `prepare`.
 */
import { isStale, lastActivityOf, SESSION_TIMEOUT_MS } from '../session-timing';

describe('session idleness (BUG-053, INV-TRAINING-005)', () => {
  it('measures from the last activity when it is present', () => {
    const createdAt = new Date('2026-10-05T09:00:00.000Z');
    const lastActivityAt = new Date('2026-10-08T08:00:00.000Z');

    expect(lastActivityOf({ lastActivityAt, createdAt }).getTime()).toBe(lastActivityAt.getTime());
  });

  it('falls back to updatedAt, then createdAt, when lastActivityAt is absent', () => {
    const createdAt = new Date('2026-10-05T09:00:00.000Z');
    const updatedAt = new Date('2026-10-06T09:00:00.000Z');

    expect(lastActivityOf({ updatedAt, createdAt }).getTime()).toBe(updatedAt.getTime());
    expect(lastActivityOf({ createdAt }).getTime()).toBe(createdAt.getTime());
  });

  it('the timeout boundary is strict: exactly SESSION_TIMEOUT_MS of idle is not stale', () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    const createdAt = new Date('2026-10-05T09:00:00.000Z');
    const exactlyIdle = new Date(now.getTime() - SESSION_TIMEOUT_MS);
    const justPast = new Date(exactlyIdle.getTime() - 1);

    expect(isStale({ lastActivityAt: exactlyIdle, createdAt }, now)).toBe(false);
    expect(isStale({ lastActivityAt: justPast, createdAt }, now)).toBe(true);
  });
});
