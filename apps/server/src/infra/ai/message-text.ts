/**
 * Message content as text — the one home (D-F, BACKLOG consolidation; prompt-caching review R2 folded the
 * copies in llm-call-recorder, cache-attribution and the eval harness into `textOnly`).
 */

/** Flattens message content to its text blocks; anything that is not a text block is dropped. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text?: string } => typeof b === 'object' && b !== null && 'type' in b)
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('');
  }
  return '';
}

/**
 * The text of content that is ONLY text — a string, or a list of text parts (`cache_control` and other keys on a
 * part are ignored) — joined; null when any part is not a text part (image, tool use, …) or the content is neither,
 * so a caller can fall back to a structural representation instead of silently losing the non-text part.
 */
export function textOnly(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const parts = content as unknown[];
  if (!parts.every(p => p !== null && typeof p === 'object' && (p as { type?: unknown }).type === 'text')) {
    return null;
  }
  return parts.map(p => (p as { text?: string }).text ?? '').join('');
}
