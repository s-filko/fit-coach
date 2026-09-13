/**
 * Single token estimator for the whole eval stack and (from P2) the context
 * assembler: characters / 4, times a 1.15 safety factor that covers
 * Cyrillic-heavy text tokenising worse than Latin.
 * Master plan P2 item 3 fixes this formula — keep the two in step.
 */
const CHARS_PER_TOKEN = 4;
const SAFETY_FACTOR = 1.15;

export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil((text.length / CHARS_PER_TOKEN) * SAFETY_FACTOR);
}
