import { roundRpeToHalf } from '../rpe';

describe('roundRpeToHalf (extracted from log-set/update-last-set tools, review R2)', () => {
  it.each([
    [7, 7],
    [7.2, 7],
    [7.25, 7.5],
    [7.5, 7.5],
    [7.75, 8],
    [9.8, 10],
  ])('rounds %p to the nearest half-point %p', (input, expected) => {
    expect(roundRpeToHalf(input)).toBe(expected);
  });
});
