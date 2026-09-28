/**
 * courseCheckEvent (course-check plan Task 1, AC-FL-5): the pure event
 * predicate. The check fires on its named events and on NOTHING else — the
 * two cost assertions of the whole layer live here: a stable fingerprint with
 * no gap returns null (zero model calls), and every named event fires.
 *
 * "Entering planning" and "before a durable write" are not separate branches:
 * phase and activePlanId are fingerprint components (see fingerprint.unit.test.ts),
 * so the first run after either changes arrives as 'fingerprint_changed' —
 * edge-triggered by comparison, which is what keeps an ordinary turn free.
 */
import { courseCheckEvent } from '../events';

const NOW = new Date('2026-09-21T12:00:00Z');
const GAP_MS = 3 * 3_600_000; // EPISODE_GAP_HOURS × 3_600_000, threaded as data
const COOLDOWN_MS = 15 * 60_000; // COURSE_CHECK_RETRY_COOLDOWN_MINUTES, threaded as data

function input(overrides: Partial<Parameters<typeof courseCheckEvent>[0]> = {}) {
  return {
    fingerprint: 'fp-1',
    stored: { fingerprint: 'fp-1' },
    now: NOW,
    lastUserMessageAt: new Date('2026-09-21T11:00:00Z'),
    gapMs: GAP_MS,
    failure: null,
    cooldownMs: COOLDOWN_MS,
    ...overrides,
  };
}

describe('courseCheckEvent (AC-FL-5: fires on its events, on nothing else)', () => {
  it('nothing stored yet → fingerprint_changed (the first run establishes the directive)', () => {
    expect(courseCheckEvent(input({ stored: null }))).toBe('fingerprint_changed');
  });

  it('fingerprint differs → fingerprint_changed (fact set, goal, phase or plan moved)', () => {
    expect(courseCheckEvent(input({ fingerprint: 'fp-2' }))).toBe('fingerprint_changed');
  });

  it('stable fingerprint, ordinary cadence → null — the run costs exactly today’s cost', () => {
    expect(courseCheckEvent(input())).toBeNull();
  });

  it('first run after a long gap → long_gap (the world aged even though nothing moved)', () => {
    expect(courseCheckEvent(input({ lastUserMessageAt: new Date('2026-09-20T12:00:00Z') }))).toBe('long_gap');
    // Exactly at the threshold counts as a gap (>=, same edge as compaction).
    expect(courseCheckEvent(input({ lastUserMessageAt: new Date(NOW.getTime() - GAP_MS) }))).toBe('long_gap');
  });

  it('a gap below the threshold is not an event', () => {
    expect(courseCheckEvent(input({ lastUserMessageAt: new Date(NOW.getTime() - GAP_MS + 1) }))).toBeNull();
  });

  it('no lastUserMessageAt and a stored directive → null (the first-ever run is covered by nothing-stored)', () => {
    expect(courseCheckEvent(input({ lastUserMessageAt: null }))).toBeNull();
  });

  describe('back-off after a failed attempt (the cooldown covers only the failed fingerprint)', () => {
    const failedAt = (msAgo: number) => ({ fingerprint: 'fp-2', at: new Date(NOW.getTime() - msAgo).toISOString() });

    it('same fingerprint inside the cooldown → null, even though the stored directive is stale', () => {
      expect(courseCheckEvent(input({ fingerprint: 'fp-2', failure: failedAt(60_000) }))).toBeNull();
      expect(courseCheckEvent(input({ fingerprint: 'fp-2', stored: null, failure: failedAt(60_000) }))).toBeNull();
    });

    it('same fingerprint once the cooldown has elapsed → fires again (>=, same edge as the gap)', () => {
      expect(courseCheckEvent(input({ fingerprint: 'fp-2', failure: failedAt(COOLDOWN_MS - 1) }))).toBeNull();
      expect(courseCheckEvent(input({ fingerprint: 'fp-2', failure: failedAt(COOLDOWN_MS) }))).toBe(
        'fingerprint_changed',
      );
    });

    it('a different fingerprint inside the cooldown → fires at once', () => {
      expect(courseCheckEvent(input({ fingerprint: 'fp-3', failure: failedAt(60_000) }))).toBe('fingerprint_changed');
    });

    it('no remembered failure → unchanged behaviour', () => {
      expect(courseCheckEvent(input({ fingerprint: 'fp-2', failure: null }))).toBe('fingerprint_changed');
    });
  });
});
