import { CURRENT_TIME_V1, DEFAULT_DIRECTIVES_V1, DEFAULT_DIRECTIVES_V2, DIRECTIVES_WITHOUT_IDENTITY_V2 } from '..';
import type { DirectiveContext } from '../../types';

const ctx = (over: Partial<DirectiveContext> = {}): DirectiveContext => ({
  now: new Date('2026-09-13T10:00:00.000Z'),
  timezone: null,
  client: 'telegram',
  user: null,
  lastMessageTime: null,
  ...over,
});

describe('CURRENT_TIME_V1 (transition-handoff plan Task 7, BUG-032 — the coach knows the current time)', () => {
  it('renders weekday, date and 24h time with the zone name for a known timezone', () => {
    const { text } = CURRENT_TIME_V1.render(
      ctx({ now: new Date('2026-09-25T06:20:00.000Z'), timezone: 'Asia/Manila' }),
    )!;
    // 2026-09-25T06:20Z + 8h = 2026-09-25 14:20 local.
    expect(text).toBe("NOW (user's local time): Friday 2026-09-25 14:20 (Asia/Manila)");
  });

  it('crosses the UTC date line correctly: 2026-09-25T20:30Z in Asia/Manila is Saturday 2026-09-26 04:30', () => {
    const { text } = CURRENT_TIME_V1.render(
      ctx({ now: new Date('2026-09-25T20:30:00.000Z'), timezone: 'Asia/Manila' }),
    )!;
    expect(text).toBe("NOW (user's local time): Saturday 2026-09-26 04:30 (Asia/Manila)");
  });

  it('falls back to UTC, marked as such, when the timezone is unknown', () => {
    const { text } = CURRENT_TIME_V1.render(ctx({ now: new Date('2026-09-25T06:20:00.000Z'), timezone: null }))!;
    expect(text).toBe("NOW (UTC — user's timezone is unknown): Friday 2026-09-25 06:20");
  });

  it('is required and carries the directive.current-time id', () => {
    const section = CURRENT_TIME_V1.render(ctx())!;
    expect(section.id).toBe('directive.current-time');
    expect(section.required).toBe(true);
  });

  it('is v1', () => {
    expect(CURRENT_TIME_V1.version).toBe('v1');
  });
});

describe('DEFAULT_DIRECTIVES_V2 / DIRECTIVES_WITHOUT_IDENTITY_V2 (Task 7)', () => {
  it('is V1 plus CURRENT_TIME_V1 appended LAST — never inserted, so it is the last rendered section', () => {
    expect(DEFAULT_DIRECTIVES_V2.map(d => d.id)).toEqual([...DEFAULT_DIRECTIVES_V1.map(d => d.id), 'current-time']);
  });

  it('DEFAULT_DIRECTIVES_V1 stays untouched — the frozen v1 snapshots must never gain this line', () => {
    expect(DEFAULT_DIRECTIVES_V1.map(d => d.id)).not.toContain('current-time');
    expect(DEFAULT_DIRECTIVES_V1).toHaveLength(9);
  });

  it('the no-identity variant drops only identity, keeping current-time last', () => {
    expect(DIRECTIVES_WITHOUT_IDENTITY_V2.map(d => d.id)).toEqual(DEFAULT_DIRECTIVES_V2.map(d => d.id).slice(1));
    expect(DIRECTIVES_WITHOUT_IDENTITY_V2[DIRECTIVES_WITHOUT_IDENTITY_V2.length - 1]?.id).toBe('current-time');
  });
});
