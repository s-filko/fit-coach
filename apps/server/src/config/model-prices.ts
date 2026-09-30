import { z } from 'zod';

/** USD per 1M tokens (see infra/ai/model-prices.ts for the built-in table and the lookup). */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

const PriceOverridesSchema = z.record(
  z.string().min(1),
  z.object({ input: z.number().positive(), output: z.number().nonnegative() }),
);

/**
 * `LLM_MODEL_PRICES`: JSON `{"<model id>": {"input": <USD/1M>, "output": <USD/1M>}}`, merged over the built-in table.
 * Invalid JSON or shape throws — `config/index.ts` calls this once at config load, so a malformed value fails
 * the load like the other LLM_* tunables (callers read the parsed record from config, never re-parse).
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
