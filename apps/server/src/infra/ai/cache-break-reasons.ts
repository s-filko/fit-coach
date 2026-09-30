/**
 * Prompt-caching plan (BUG-051) D8.1: the ONE registry of reasons a run may DECLARE for breaking the provider's
 * cached prefix. A break is either declared (`planned:<reason>`) or alerted (`unplanned:<where>`), so every
 * cache-invalidating code path names itself here, at the site that causes it:
 *   phase_switch  — commit node (a same-run hop) and the compact step (a phase boundary committed by the
 *                   previous run): block 1 and the tool set of the new phase;
 *   compaction    — the compact step, when it rewrites history / summaries;
 *   hard_cap      — the compact step's budget trigger and the assembler's budget cuts firing while the cache
 *                   is warm (D5);
 *   facts_changed — the manage_fact tool (executor), the summariser's fact operations (compact step) and a new
 *                   course-check directive: the stable block changed;
 *   ttl_expired   — never declared: the gap to the previous call is measured by attribution itself (`cacheExpected`).
 */
export const CACHE_BREAK_REASONS = ['phase_switch', 'compaction', 'hard_cap', 'facts_changed', 'ttl_expired'] as const;

export type CacheBreakReason = (typeof CACHE_BREAK_REASONS)[number];

export function isCacheBreakReason(value: string): value is CacheBreakReason {
  return (CACHE_BREAK_REASONS as readonly string[]).includes(value);
}

/**
 * Does a declared reason explain a divergence at `where` (what attribution reports: `tools`, `system:prompt`,
 * `system:facts`, `system:directive`, `system:summaries`, `history[<i>]:<role>`)?
 */
export function reasonCovers(reason: string, where: string): boolean {
  const isHistory = where.startsWith('history[');
  switch (reason) {
    case 'phase_switch':
      return where === 'tools' || where === 'system:prompt';
    case 'compaction':
    case 'hard_cap':
      return isHistory || where === 'system:summaries';
    case 'facts_changed':
      return where === 'system:facts' || where === 'system:directive';
    case 'ttl_expired':
      return true;
    default:
      return false;
  }
}
