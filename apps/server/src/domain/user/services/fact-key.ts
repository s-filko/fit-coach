// D-C idempotency key (ADR-0009) — kept in a dependency-free module so the
// graph tests and any other consumer share the real normaliser without
// importing the Drizzle repository (and its pool).

/**
 * Normalises fact text into the D-C idempotency key: lowercase, trim, collapse
 * whitespace, strip terminal punctuation. Deterministic and testable without a model.
 */
export function computeFactKey(fact: string): string {
  return fact
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/, '');
}
