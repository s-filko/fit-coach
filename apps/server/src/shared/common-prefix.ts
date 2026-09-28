/** The length of the longest common prefix of two strings — shared by exercise-name-check.ts's
 * plural/compound word matching and cache-attribution.ts's divergence-offset computation. */
export function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) {
    i += 1;
  }
  return i;
}
