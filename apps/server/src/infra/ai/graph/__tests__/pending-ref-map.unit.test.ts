import { PendingRefMap } from '../pending-ref-map';

describe('PendingRefMap', () => {
  it('stores and retrieves values by key', () => {
    const map = new PendingRefMap<string>();
    map.set('a', 'value-a');
    expect(map.get('a')).toBe('value-a');
  });

  it('returns undefined for missing keys', () => {
    const map = new PendingRefMap<string>();
    expect(map.get('missing')).toBeUndefined();
  });

  it('deletes entries', () => {
    const map = new PendingRefMap<string>();
    map.set('a', 'value');
    expect(map.delete('a')).toBe(true);
    expect(map.get('a')).toBeUndefined();
  });

  it('reports size correctly', () => {
    const map = new PendingRefMap<number>();
    expect(map.size).toBe(0);
    map.set('a', 1);
    map.set('b', 2);
    expect(map.size).toBe(2);
    map.delete('a');
    expect(map.size).toBe(1);
  });

  it('evicts stale entries on set()', () => {
    const map = new PendingRefMap<string>(100);
    map.set('old', 'stale');

    // Fast-forward time past TTL
    jest.useFakeTimers();
    jest.advanceTimersByTime(200);

    map.set('new', 'fresh');

    expect(map.get('old')).toBeUndefined();
    expect(map.get('new')).toBe('fresh');
    expect(map.size).toBe(1);

    jest.useRealTimers();
  });

  it('returns undefined for expired entry on get()', () => {
    const map = new PendingRefMap<string>(100);
    map.set('key', 'value');

    jest.useFakeTimers();
    jest.advanceTimersByTime(200);

    expect(map.get('key')).toBeUndefined();

    jest.useRealTimers();
  });

  it('isolates entries by key — no cross-contamination', () => {
    const map = new PendingRefMap<string>();
    map.set('userA', 'session-A');
    map.set('userB', 'session-B');

    expect(map.get('userA')).toBe('session-A');
    expect(map.get('userB')).toBe('session-B');

    map.delete('userA');
    expect(map.get('userA')).toBeUndefined();
    expect(map.get('userB')).toBe('session-B');
  });
});
