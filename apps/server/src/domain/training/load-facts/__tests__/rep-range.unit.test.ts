import { parseRepRange } from '../rep-range';

describe('AC-LF-1 · parseRepRange (D8)', () => {
  it.each([
    ['8-12', { min: 8, max: 12 }],
    ['8–12', { min: 8, max: 12 }],
    ['8 - 12', { min: 8, max: 12 }],
    [' 8 — 12 ', { min: 8, max: 12 }],
    ['10', { min: 10, max: 10 }],
  ])('parses %j', (text, expected) => {
    expect(parseRepRange(text)).toEqual(expected);
  });

  it.each([['AMRAP'], ['до отказа'], [''], ['12-8'], ['8-'], ['3x10'], ['0']])('rejects %j', text => {
    expect(parseRepRange(text)).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(parseRepRange(null)).toBeNull();
    expect(parseRepRange(undefined)).toBeNull();
  });
});
