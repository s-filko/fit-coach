/**
 * Postgres errors surface through several layers of wrapping — drizzle-orm (>= 0.44) wraps the raw
 * driver error in a DrizzleQueryError whose `cause` is the pg error, and that can itself be wrapped
 * again — so the real SQLSTATE `code` (and `constraint`/`message`) is not reliably at any one fixed
 * depth. Walk the `.cause` chain up to `maxDepth` levels (5 — deep enough for every wrapping seen in
 * this codebase) and return the first level for which `match` returns non-null, rather than each
 * caller re-inventing how far down to look.
 */
export function findInErrorCauseChain<T>(
  err: unknown,
  match: (level: { code?: unknown; message?: unknown; constraint?: unknown }) => T | null,
  maxDepth = 5,
): T | null {
  for (let current = err, depth = 0; typeof current === 'object' && current !== null && depth < maxDepth; depth++) {
    const level = current as { code?: unknown; message?: unknown; constraint?: unknown; cause?: unknown };
    const result = match(level);
    if (result !== null) {
      return result;
    }
    current = level.cause;
  }
  return null;
}
