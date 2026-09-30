/**
 * Prompt-caching plan (BUG-051) AC-PC-8 / D8.5: list prices per model, so `scripts/cache-report.ts` can cost a workout
 * the way the provider bills it (input, cache read/write multipliers, OUTPUT) and be compared with the run's real bill.
 * USD per 1M tokens, uncached list price. Not exhaustive on purpose: a model that is neither in this table nor in
 * `LLM_MODEL_PRICES` is reported as unpriced, never guessed. The Sonnet 5.5 / Haiku 4.5 figures are the Anthropic list
 * prices as configured for this app — verify against the provider's price page before quoting a total as a bill.
 */
import { z } from 'zod';

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const DEFAULT_MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'anthropic/claude-sonnet-5.5': { inputPerMTok: 3, outputPerMTok: 15 },
  'anthropic/claude-haiku-4.5': { inputPerMTok: 1, outputPerMTok: 5 },
};

const PriceOverridesSchema = z.record(
  z.string().min(1),
  z.object({ input: z.number().positive(), output: z.number().nonnegative() }),
);

/**
 * `LLM_MODEL_PRICES`: JSON `{"<model id>": {"input": <USD/1M>, "output": <USD/1M>}}`, merged over the built-in table.
 * Invalid JSON or shape throws (fail fast at config load, like the other LLM_* tunables).
 */
export function parseModelPrices(raw: string | undefined): Record<string, ModelPrice> {
  if (raw === undefined || raw.trim() === '') {
    return {};
  }
  const parsed = PriceOverridesSchema.parse(JSON.parse(raw));
  return Object.fromEntries(
    Object.entries(parsed).map(([model, p]) => [model, { inputPerMTok: p.input, outputPerMTok: p.output }]),
  );
}

/** The price of `model`: config override first, then the built-in table; null when unknown. */
export function priceOf(model: string, overrides: Readonly<Record<string, ModelPrice>> = {}): ModelPrice | null {
  return overrides[model] ?? DEFAULT_MODEL_PRICES[model] ?? null;
}
