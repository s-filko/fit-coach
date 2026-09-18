import type { TransitionHandler } from '@domain/conversation/events';

/**
 * D-A (refactor-p4-episode-memory Task 4): the owner's "compaction consumes
 * the event" — a committed phase boundary flags the episode for compaction;
 * `prepare` of the NEXT run runs `compact` before the first model call
 * (compacting at commit time would summarise while the user waits for a reply
 * that is already produced).
 *
 * Wired FIRST in the onTransition list, before session-lifecycle: the flag is
 * cheap and must be set even if a later handler fails.
 */
export function buildCompactionFlagHandler(): TransitionHandler {
  return async () => ({ compactReason: 'phase_boundary' });
}
