/**
 * errorCodeOf (voice-transcription plan Task 4, F2/B3): the one duck-typed
 * "code of a thrown error against a status map" check, shared by
 * chat.routes.ts and voice.routes.ts. The map doubles as the allowed-code
 * set, so a route's own CORE_ERROR → 500 simply lives in the map it passes —
 * no special-case branch. Pure: never throws on any `unknown`.
 */
export function errorCodeOf<C extends string>(err: unknown, statuses: Record<C, number>): C | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code in statuses ? (code as C) : undefined;
}
