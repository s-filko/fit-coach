import { BREAK_REASONS, breakReasonOf, formatBreakFact, parseBreakFact } from '../break-fact';

/** AC-LP-6 / D9: the `break` fact text carries dates and a reason class the code can read back. */
describe('AC-LP-6 break fact text', () => {
  it('round-trips reason, dates and the user words', () => {
    const text = formatBreakFact({
      reason: 'illness',
      from: '2026-09-01',
      to: '2026-09-29',
      words: 'I had the flu',
    });
    expect(text).toBe('break reason=illness from=2026-09-01 to=2026-09-29 — I had the flu');
    expect(parseBreakFact(text)).toEqual({
      reason: 'illness',
      from: '2026-09-01',
      to: '2026-09-29',
      words: 'I had the flu',
    });
  });

  it('knows the six reason classes', () => {
    expect([...BREAK_REASONS]).toEqual([
      'illness',
      'injury',
      'holiday_work_no_time',
      'deliberate_deload',
      'stress_poor_sleep',
      'unknown',
    ]);
  });

  it.each([
    ['break reason=vacation from=2026-09-01 to=2026-09-29 — x'],
    ['break reason=illness from=yesterday to=2026-09-29 — x'],
    ['break reason=illness from=2026-09-29 to=2026-09-01 — x'],
    ['illness in september'],
    [''],
  ])('rejects %j', text => {
    expect(parseBreakFact(text)).toBeNull();
  });

  it('words are optional', () => {
    expect(parseBreakFact('break reason=unknown from=2026-09-01 to=2026-09-29')).toMatchObject({ reason: 'unknown' });
  });

  it('breakReasonOf picks the newest break that overlaps the gap window', () => {
    const facts = [
      {
        fact: 'break reason=holiday_work_no_time from=2026-06-01 to=2026-06-20 — trip',
        createdAt: new Date('2026-06-21'),
      },
      { fact: 'break reason=illness from=2026-09-01 to=2026-09-29 — flu', createdAt: new Date('2026-09-29') },
      { fact: 'not a break fact', createdAt: new Date('2026-09-30') },
    ];
    expect(breakReasonOf(facts, { from: '2026-08-28', to: '2026-09-29' })).toBe('illness');
    expect(breakReasonOf(facts, { from: '2026-05-25', to: '2026-06-21' })).toBe('holiday_work_no_time');
    expect(breakReasonOf(facts, { from: '2026-07-10', to: '2026-07-20' })).toBeNull();
    expect(breakReasonOf([], { from: '2026-08-28', to: '2026-09-29' })).toBeNull();
  });

  // Fix-9: the window's ends are training days, so a fact only belongs to a gap when it covers a day strictly between.
  it('a fact that ends on the day the gap starts (the asked-on day the user then trained) is not in the next gap', () => {
    const old = [
      { fact: 'break reason=illness from=2026-08-01 to=2026-08-20 — flu', createdAt: new Date('2026-08-20') },
    ];
    expect(breakReasonOf(old, { from: '2026-08-20', to: null })).toBeNull();
    expect(breakReasonOf(old, { from: '2026-08-19', to: null })).toBe('illness');
  });

  it('a closed gap window excludes a fact that starts on the training day that ended it', () => {
    const next = [{ fact: 'break reason=unknown from=2026-09-01 to=2026-09-29', createdAt: new Date('2026-09-29') }];
    expect(breakReasonOf(next, { from: '2026-08-01', to: '2026-09-01' })).toBeNull();
    expect(breakReasonOf(next, { from: '2026-08-01', to: '2026-09-02' })).toBe('unknown');
  });
});
