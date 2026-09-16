/**
 * The single token estimator for the app and the eval stack: characters / 4,
 * times a 1.15 safety factor that covers Cyrillic-heavy text tokenising worse
 * than Latin. Master plan P2 item 3 fixes this formula.
 *
 * TOKEN_ESTIMATOR_ID is stamped into every BudgetReport: changing the formula
 * means changing the id.
 */
const CHARS_PER_TOKEN = 4;
const SAFETY_FACTOR = 1.15;

export const TOKEN_ESTIMATOR_ID = 'chars4x1.15';

export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil((text.length / CHARS_PER_TOKEN) * SAFETY_FACTOR);
}
