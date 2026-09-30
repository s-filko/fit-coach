import { priceOf } from '@infra/ai/model-prices';

import { parseModelPrices } from '@config/model-prices';

describe('model prices (AC-PC-8 cost comparability)', () => {
  it('AC-PC-8: the built-in table prices the app’s Anthropic models incl. output', () => {
    expect(priceOf('anthropic/claude-sonnet-5.5')).toEqual({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(priceOf('anthropic/claude-haiku-4.5')).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
  });

  it('AC-PC-8: an unknown model is null — never guessed', () => {
    expect(priceOf('vendor/unknown')).toBeNull();
  });

  it('AC-PC-8: LLM_MODEL_PRICES JSON overrides the table and adds models; empty/unset is no override', () => {
    const overrides = parseModelPrices(
      '{"anthropic/claude-sonnet-5.5":{"input":4,"output":20},"x/y":{"input":1,"output":0}}',
    );
    expect(priceOf('anthropic/claude-sonnet-5.5', overrides)).toEqual({ inputPerMTok: 4, outputPerMTok: 20 });
    expect(priceOf('x/y', overrides)).toEqual({ inputPerMTok: 1, outputPerMTok: 0 });
    expect(parseModelPrices(undefined)).toEqual({});
    expect(parseModelPrices('  ')).toEqual({});
  });

  it('AC-PC-8: a malformed override fails fast', () => {
    expect(() => parseModelPrices('not json')).toThrow();
    expect(() => parseModelPrices('{"m":{"input":-1,"output":1}}')).toThrow();
  });
});
