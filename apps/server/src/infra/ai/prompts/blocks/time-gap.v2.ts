import type { GapTier } from '@domain/training/load-plan';

import type { PromptModule, Section } from '@infra/ai/prompts/types';

import { TIME_GAP_PREFIX } from './time-gap.v1';

/** The training break the note also speaks about (load-plan Task 4, D9): the same tier LOAD PLAN reads. */
export interface TrainingBreakNote {
  tier: GapTier;
  /** Calendar days since the last real workout. */
  days: number;
  /** The reason question has not been asked for this break: ask it once, now. */
  ask: boolean;
}

export interface TimeGapV2Context {
  /** Milliseconds since the user's previous message when it is ≥ the episode gap; null = no message gap. */
  gapMs: number | null;
  training?: TrainingBreakNote;
}

function formatHours(gapMs: number): string {
  const hours = Math.round((gapMs / 3_600_000) * 10) / 10;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

const ASK =
  'Before any training talk, ask ONCE, in one short question, what happened (illness, injury, holiday or work, a planned pause, stress or poor sleep, something else). Do not ask again; if they skip it, carry on.';

/**
 * The time-gap note v2 (load-plan Task 4, D9 — `LOAD_PLAN_BREAKS` only): v1's sentence for a pause between
 * messages, plus the training-break tier the `LOAD PLAN` block reads (one long-time-no-see mechanism) and,
 * once per break, the instruction to ask the reason. Every text starts with the v1 prefix, so cache
 * attribution still labels it `system:gap-note`. Pure: the tier arrives as data.
 */
export const TIME_GAP_V2: PromptModule<TimeGapV2Context> = {
  id: 'block.time_gap',
  version: 'v2',
  directives: [],
  render({ gapMs, training }): Section[] {
    const parts: string[] = [];
    if (gapMs !== null) {
      parts.push(
        `${TIME_GAP_PREFIX} ${formatHours(gapMs)} h. Reply to their new message first; the earlier conversation is context, not an agenda.`,
      );
    }
    if (training) {
      const breakText = `training break of ${training.days} days since the last workout (tier ${training.tier}, general norm)`;
      parts.push(gapMs === null ? `${TIME_GAP_PREFIX} a ${breakText}.` : `Training: ${breakText}.`);
      if (training.ask) {
        parts.push(ASK);
      }
    }
    return [{ id: 'time_gap', required: true, text: parts.join(' ') }];
  },
};
