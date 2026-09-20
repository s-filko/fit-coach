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

function input(overrides: Partial<Parameters<typeof courseCheckEvent>[0]> = {}) {
  return {
    fingerprint: 'fp-1',
    stored: { fingerprint: 'fp-1' },
    now: NOW,
    lastUserMessageAt: new Date('2026-09-21T11:00:00Z'),
    gapMs: GAP_MS,
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
});
