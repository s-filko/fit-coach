/**
 * The NOW line (transition-handoff plan Task 7, BUG-032; moved to blocks/ by
 * the now-line-last review — it is no longer a directive but a standalone
 * message module like the gap note): the rendered text is frozen (AC-NL-4) —
 * both timezone variants byte-for-byte what block 1 used to carry.
 */
import { renderBlock } from '@infra/ai/prompts/blocks';

import { DEFAULT_DIRECTIVES_V1, DEFAULT_DIRECTIVES_V2, DIRECTIVES_WITHOUT_IDENTITY_V2 } from '../../directives';
import { CURRENT_TIME_PREFIX, CURRENT_TIME_V1 } from '../current-time.v1';

describe('CURRENT_TIME_V1 (BUG-032 — the coach knows the current time)', () => {
  it('renders weekday, date and 24h time with the zone name for a known timezone', () => {
    const text = renderBlock(CURRENT_TIME_V1, { now: new Date('2026-09-25T06:20:00.000Z'), timezone: 'Asia/Manila' });
    // 2026-09-25T06:20Z + 8h = 2026-09-25 14:20 local.
    expect(text).toBe("NOW (user's local time): Friday 2026-09-25 14:20 (Asia/Manila)");
  });

  it('crosses the UTC date line correctly: 2026-09-25T20:30Z in Asia/Manila is Saturday 2026-09-26 04:30', () => {
    const text = renderBlock(CURRENT_TIME_V1, { now: new Date('2026-09-25T20:30:00.000Z'), timezone: 'Asia/Manila' });
    expect(text).toBe("NOW (user's local time): Saturday 2026-09-26 04:30 (Asia/Manila)");
  });

  it('falls back to UTC, marked as such, when the timezone is unknown', () => {
    const text = renderBlock(CURRENT_TIME_V1, { now: new Date('2026-09-25T06:20:00.000Z'), timezone: null });
    expect(text).toBe("NOW (UTC — user's timezone is unknown): Friday 2026-09-25 06:20");
  });

  it('renders exactly one required section carrying the current_time id', () => {
    const sections = CURRENT_TIME_V1.render({ now: new Date('2026-09-25T06:20:00.000Z'), timezone: null });
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('current_time');
    expect(sections[0].required).toBe(true);
  });

  it('is block.current_time v1 — the promptVersions key (review R1)', () => {
    expect(CURRENT_TIME_V1.id).toBe('block.current_time');
    expect(CURRENT_TIME_V1.version).toBe('v1');
  });

  it('CURRENT_TIME_PREFIX prefixes both timezone variants (D4 — the attribution label matches on it)', () => {
    const known = renderBlock(CURRENT_TIME_V1, { now: new Date('2026-09-25T06:20:00.000Z'), timezone: 'Asia/Manila' });
    const unknown = renderBlock(CURRENT_TIME_V1, { now: new Date('2026-09-25T06:20:00.000Z'), timezone: null });
    expect(known.startsWith(CURRENT_TIME_PREFIX)).toBe(true);
    expect(unknown.startsWith(CURRENT_TIME_PREFIX)).toBe(true);
  });
});

describe('DEFAULT_DIRECTIVES_V2 / DIRECTIVES_WITHOUT_IDENTITY_V2 (now-line-last, D3)', () => {
  it('no longer contains current-time — the NOW line left block 1 for its own message before `current`', () => {
    expect(DEFAULT_DIRECTIVES_V2.map(d => d.id)).toEqual(DEFAULT_DIRECTIVES_V1.map(d => d.id));
    expect(DEFAULT_DIRECTIVES_V2.map(d => d.id)).not.toContain('current-time');
  });

  it('DEFAULT_DIRECTIVES_V1 stays untouched — the frozen v1 snapshots must never gain this line', () => {
    expect(DEFAULT_DIRECTIVES_V1.map(d => d.id)).not.toContain('current-time');
    expect(DEFAULT_DIRECTIVES_V1).toHaveLength(9);
  });

  it('the no-identity variant still drops only identity (same slice rule, no current-time)', () => {
    expect(DIRECTIVES_WITHOUT_IDENTITY_V2.map(d => d.id)).toEqual(DEFAULT_DIRECTIVES_V2.map(d => d.id).slice(1));
    expect(DIRECTIVES_WITHOUT_IDENTITY_V2.map(d => d.id)).not.toContain('current-time');
  });
});
