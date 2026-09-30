/**
 * Prompt-caching plan (BUG-051) AC-PC-8 / D8.5: prices per model, so `scripts/cache-report.ts` and the cache-break
 * cost log can cost a workout the way the provider bills it (input, cache read/write multipliers, OUTPUT) and be
 * compared with the run's real bill — this table plus the `LLM_MODEL_PRICES` override are the ONE price source.
 * USD per 1M tokens, uncached. Not exhaustive on purpose: a model that is neither in this table nor in
 * `LLM_MODEL_PRICES` is reported as unpriced, never guessed. The figures are the prices as configured for this app:
 * Sonnet 5.5 is fitted to the OpenRouter charge of BUG-051 (see below), Haiku 4.5 is the list price — verify
 * before quoting a total as a bill.
 */
import type { ModelPrice } from '@config/model-prices';

export type { ModelPrice };

export const DEFAULT_MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  // $2/$10 reproduced the 2026-09-29 OpenRouter charge ($3.61 est. vs $3.63 billed, BUG-051).
  'anthropic/claude-sonnet-5.5': { inputPerMTok: 2, outputPerMTok: 10 },
  'anthropic/claude-haiku-4.5': { inputPerMTok: 1, outputPerMTok: 5 },
};

/** The price of `model`: config override first, then the built-in table; null when unknown. */
export function priceOf(model: string, overrides: Readonly<Record<string, ModelPrice>> = {}): ModelPrice | null {
  return overrides[model] ?? DEFAULT_MODEL_PRICES[model] ?? null;
}
