/** Rounds to the nearest half-point; RPE is only ever meaningful in 0.5 steps. */
export function roundRpeToHalf(rpe: number): number {
  return Math.round(rpe * 2) / 2;
}
