import type { PromptModule, Section } from '@infra/ai/prompts/types';

export interface TimeGapContext {
  /** The elapsed time since the user's previous message, in milliseconds (≥ the episode gap). */
  gapMs: number;
}

/**
 * The block's stable opening phrase — the only part fixed across renders (the hour count varies).
 * cache-attribution.ts's label derivation matches on this, not a copy.
 */
export const TIME_GAP_PREFIX = 'The user returns after';

/**
 * One decimal only when non-integer — the journey scenarios assert the
 * markers "The user returns after 14 h" and "The user returns after 3.5 h"
 * verbatim (AC-CC-2).
 */
function formatHours(gapMs: number): string {
  const hours = Math.round((gapMs / 3_600_000) * 10) / 10;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/**
 * The time-gap note (chat-continuity plan Task 2, AC-CC-2 / BUG-018): one
 * short system note the assembler places immediately before the user's new
 * message when the gap since their previous message exceeds
 * EPISODE_GAP_HOURS — the model can tell time has passed and answers the new
 * message first instead of pushing the pre-pause agenda. Pure (BR-LLM-007):
 * the gap arrives as data, no clock reads.
 */
export const TIME_GAP_V1: PromptModule<TimeGapContext> = {
  id: 'block.time_gap',
  version: 'v1',
  directives: [],
  render({ gapMs }): Section[] {
    return [
      {
        id: 'time_gap',
        required: true,
        text: `${TIME_GAP_PREFIX} ${formatHours(gapMs)} h. Reply to their new message first; the earlier conversation is context, not an agenda.`,
      },
    ];
  },
};
