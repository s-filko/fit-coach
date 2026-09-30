/**
 * Prompt-caching plan (BUG-051) T2 — AC-PC-9 (D8.1): ONE registry of declarable cache-break reasons.
 *
 * Interface assumed (T5b implements; the module is new, so importing it is the accepted red):
 *   `@infra/ai/cache-break-reasons` exports
 *     CACHE_BREAK_REASONS: readonly ['phase_switch','compaction','hard_cap','facts_changed','ttl_expired']
 *     reasonCovers(reason, where): boolean — does a declared reason explain a divergence at `where`
 *   `where` is what attribution reports: 'tools' | 'system:prompt' | 'system:facts' | 'system:directive' |
 *   'system:summaries' | `history[<i>]:<role>`.
 */
// Loaded with `require` so `tsc` (type-check, which includes this file) stays clean while the module does not
// exist yet; jest resolves the alias at run time and the suite is red with "Cannot find module" until T5b.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const registry = require('@infra/ai/cache-break-reasons') as {
  CACHE_BREAK_REASONS: readonly string[];
  reasonCovers: (reason: string, where: string) => boolean;
};
const { CACHE_BREAK_REASONS, reasonCovers } = registry;

describe('cache-break reason registry (D8.1)', () => {
  it('AC-PC-9: the registry lists exactly the five declared reasons', () => {
    expect([...CACHE_BREAK_REASONS].sort()).toEqual(
      ['compaction', 'facts_changed', 'hard_cap', 'phase_switch', 'ttl_expired'].sort(),
    );
  });

  it.each([
    ['phase_switch', 'tools', true],
    ['phase_switch', 'system:prompt', true],
    ['phase_switch', 'history[3]:user', false],
    ['compaction', 'history[0]:user', true],
    ['compaction', 'system:summaries', true],
    ['compaction', 'system:prompt', false],
    ['hard_cap', 'history[5]:assistant', true],
    ['hard_cap', 'tools', false],
    ['facts_changed', 'system:facts', true],
    ['facts_changed', 'system:directive', true],
    ['facts_changed', 'history[1]:user', false],
    ['ttl_expired', 'system:prompt', true],
    ['ttl_expired', 'history[2]:assistant', true],
  ] as const)('AC-PC-9: reasonCovers(%s, %s) → %s', (reason, where, expected) => {
    expect(reasonCovers(reason, where)).toBe(expected);
  });
});
