/**
 * Prompt-caching plan (BUG-051) D5: the two shared answers behind "defer budget compaction / trimming while the
 * provider cache is warm" — ONE warm predicate and ONE hard-cap measure, used by the compact step and the assembler
 * alike. Two different measures (or two copies of the predicate) would leave a band where the compact step says
 * "under the cap, skip" while the assembler says "over, trim" — a sliding trim on every warm call.
 */
import type { BaseMessage } from '@langchain/core/messages';

/** The cache settings the episode config carries (set only with `LLM_PROMPT_CACHE=anthropic`). */
export interface CacheWarmthTunables {
  /** LLM_PROMPT_CACHE_TTL in ms. */
  cacheTtlMs?: number;
  /** LLM_CONTEXT_HARD_CAP_TOKENS. */
  hardCapTokens?: number;
}

/**
 * `{ hardCapTokens }` while the user's previous message is younger than the cache TTL (a hit refreshes the TTL after
 * that message was stamped, so measuring from it is the conservative side); null when not warm, never seen, or the
 * route has no explicit caching configured. Reads `tunables` only once a previous message exists.
 */
export function warmCacheOf(
  tunables: CacheWarmthTunables,
  lastUserMessageAt: string | null,
  now: Date,
): { hardCapTokens: number } | null {
  if (lastUserMessageAt === null) {
    return null;
  }
  const { cacheTtlMs, hardCapTokens } = tunables;
  return cacheTtlMs !== undefined &&
    hardCapTokens !== undefined &&
    now.getTime() - Date.parse(lastUserMessageAt) < cacheTtlMs
    ? { hardCapTokens }
    : null;
}

/**
 * The hard-cap measure: what the conversation itself has accumulated — the episode history plus this run's
 * messages, in the estimator's units. The fixed parts (system prompt, facts, blocks) are excluded on purpose: they
 * are what the cache holds, not what grows.
 */
export function conversationTokens(
  history: readonly BaseMessage[],
  current: readonly BaseMessage[],
  estimate: (messages: readonly BaseMessage[]) => number,
): number {
  return estimate(history) + estimate(current);
}
