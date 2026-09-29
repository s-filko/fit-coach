import type { RepRange } from './types';

const RANGE_RE = /^\s*(\d+)\s*[-–—]\s*(\d+)\s*$/;
const SINGLE_RE = /^\s*(\d+)\s*$/;

/**
 * load-facts plan D8: parse `target_reps` text — "8-12", "8–12", "8 - 12" → [8,12], "10" → [10,10].
 * Anything else (AMRAP, "3x10", an inverted or zero range) → null: the metrics that need a range
 * are then absent with `no rep range`.
 */
export function parseRepRange(text: string | null | undefined): RepRange | null {
  if (!text) {
    return null;
  }
  const range = RANGE_RE.exec(text);
  const single = range ? null : SINGLE_RE.exec(text);
  const min = Number(range?.[1] ?? single?.[1]);
  const max = Number(range?.[2] ?? single?.[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min) {
    return null;
  }
  return { min, max };
}
