import type { SetKind } from './types';

/**
 * set-kind plan Task 1 (D4): only working sets count against a plan target. A NULL/absent
 * `setKind` (legacy row, or a fixture that never set it) counts as working — today's behaviour,
 * unchanged (AC-SK-3). A domain rule, not a prompt concern (close-out review advisory R1) — the
 * prompt block (`training-workout-overview.v1.ts`) and `format-exercise-summary.ts` both reuse
 * this one copy.
 */
export function workingSets<T extends { setKind?: SetKind | null }>(sets: T[]): T[] {
  return sets.filter(s => s.setKind !== 'warmup');
}
