import { extractUsage, extractUsageFromLLMResult, extractUsageFromMessage, stripRawResponse } from '@infra/ai/usage';

describe('extractUsage (D2): generation.message.usage_metadata is authoritative, llmOutput.tokenUsage the fallback', () => {
  it('AC-CA-1: reads input/output/cache_read/reasoning off usage_metadata, 0 preserved as reported (not null)', () => {
    const extracted = extractUsage(
      {
        input_tokens: 5765,
        output_tokens: 30,
        input_token_details: { cache_read: 5760 },
        output_token_details: { reasoning: 30 },
      },
      undefined,
    );
    expect(extracted).toEqual({
      inputTokens: 5765,
      outputTokens: 30,
      cacheReadTokens: 5760,
      reasoningTokens: 30,
      cacheWriteTokens: null,
    });
  });

  it('a first call with no cache hit yet reports cache_read: 0 — stored as 0, not null (0 ≠ unreported)', () => {
    const extracted = extractUsage(
      { input_tokens: 5765, output_tokens: 30, input_token_details: { cache_read: 0 } },
      undefined,
    );
    expect(extracted.cacheReadTokens).toBe(0);
  });

  it('AC-CA-1: usage_metadata without cache/reasoning details stores those as null, never 0', () => {
    const extracted = extractUsage({ input_tokens: 100, output_tokens: 10 }, undefined);
    expect(extracted).toEqual({
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: null,
      reasoningTokens: null,
      cacheWriteTokens: null,
    });
  });

  it('falls back to tokenUsage (input/output only, never cache/reasoning) when usage_metadata is absent', () => {
    const extracted = extractUsage(undefined, { promptTokens: 42, completionTokens: 7 });
    expect(extracted).toEqual({
      inputTokens: 42,
      outputTokens: 7,
      cacheReadTokens: null,
      reasoningTokens: null,
      cacheWriteTokens: null,
    });
  });

  it('falls back to tokenUsage when usage_metadata is present but carries no input_tokens number', () => {
    const extracted = extractUsage({}, { promptTokens: 42, completionTokens: 7 });
    expect(extracted).toEqual({
      inputTokens: 42,
      outputTokens: 7,
      cacheReadTokens: null,
      reasoningTokens: null,
      cacheWriteTokens: null,
    });
  });

  it('everything null when neither source reports anything', () => {
    expect(extractUsage(undefined, undefined)).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
      cacheWriteTokens: null,
    });
  });
});

describe('extractUsageFromLLMResult (run-metrics.ts / llm-log-handler.ts shape)', () => {
  it('reads usage_metadata off generations[0][0].message', () => {
    const output = {
      generations: [[{ message: { usage_metadata: { input_tokens: 10, output_tokens: 2 } } }]],
      llmOutput: { tokenUsage: { promptTokens: 999, completionTokens: 999 } },
    };
    expect(extractUsageFromLLMResult(output)).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: null,
      reasoningTokens: null,
      cacheWriteTokens: null,
    });
  });

  it('falls back to llmOutput.tokenUsage when there is no generation message at all', () => {
    expect(extractUsageFromLLMResult({ llmOutput: { tokenUsage: { promptTokens: 5, completionTokens: 1 } } })).toEqual({
      inputTokens: 5,
      outputTokens: 1,
      cacheReadTokens: null,
      reasoningTokens: null,
      cacheWriteTokens: null,
    });
  });

  it('an empty generations array (the phase-summary call shape) never throws', () => {
    expect(extractUsageFromLLMResult({ generations: [] })).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
      cacheWriteTokens: null,
    });
  });
});

describe('extractUsageFromMessage (agent.node.ts shape: a resolved AIMessage)', () => {
  it('reads usage_metadata directly off the message', () => {
    const result = extractUsageFromMessage({
      usage_metadata: { input_tokens: 20, output_tokens: 4, output_token_details: { reasoning: 3 } },
    });
    expect(result).toEqual({
      inputTokens: 20,
      outputTokens: 4,
      cacheReadTokens: null,
      reasoningTokens: 3,
      cacheWriteTokens: null,
    });
  });

  it('falls back to response_metadata.tokenUsage', () => {
    const result = extractUsageFromMessage({
      response_metadata: { tokenUsage: { promptTokens: 8, completionTokens: 1 } },
    });
    expect(result).toEqual({
      inputTokens: 8,
      outputTokens: 1,
      cacheReadTokens: null,
      reasoningTokens: null,
      cacheWriteTokens: null,
    });
  });
});

describe('cache write tokens from the raw provider response (prompt-caching plan D7)', () => {
  const raw = (usage: unknown) => ({ additional_kwargs: { __raw_response: { usage } } });

  it('extractUsageFromMessage reads prompt_tokens_details.cache_write_tokens off the raw response', () => {
    const usage = extractUsageFromMessage({
      usage_metadata: { input_tokens: 100, output_tokens: 5 },
      ...raw({ prompt_tokens_details: { cache_write_tokens: 110 } }),
    });
    expect(usage.cacheWriteTokens).toBe(110);
  });

  it('extractUsageFromLLMResult reads it off the generation message', () => {
    const usage = extractUsageFromLLMResult({
      generations: [
        [
          {
            message: {
              usage_metadata: { input_tokens: 10, output_tokens: 1 },
              ...raw({ prompt_tokens_details: { cache_write_tokens: 0 } }),
            },
          },
        ],
      ],
    });
    expect(usage.cacheWriteTokens).toBe(0);
  });

  it.each([
    ['no raw response', {}],
    ['no usage', raw(undefined)],
    ['no details', raw({})],
    ['a string', raw({ prompt_tokens_details: { cache_write_tokens: '110' } })],
    ['negative', raw({ prompt_tokens_details: { cache_write_tokens: -1 } })],
    ['null usage', raw(null)],
  ])('%s → null, never throws', (_label, message) => {
    expect(
      extractUsageFromMessage({ usage_metadata: { input_tokens: 1, output_tokens: 1 }, ...message }).cacheWriteTokens,
    ).toBeNull();
  });

  it('stripRawResponse drops the raw response in place and tolerates messages without one', () => {
    const message = { additional_kwargs: { __raw_response: { big: true }, keep: 1 } };
    stripRawResponse(message);
    expect(message.additional_kwargs).toEqual({ keep: 1 });
    expect(() => stripRawResponse({})).not.toThrow();
  });
});
