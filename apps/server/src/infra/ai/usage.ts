/**
 * D2 (cache-accounting plan Task 1): one shared extractor for every reader of a model response's
 * token usage — `generation.message.usage_metadata` (LangChain's own parsed shape, carrying the
 * cache/reasoning detail Z.AI and OpenAI-compatible providers return) is authoritative;
 * `llmOutput.tokenUsage` (input/output only — @langchain/openai never puts cache/reasoning detail
 * there, see completions.js) is the fallback for a caller that never sees the generation message.
 * A field the provider did not report comes back `null`, never `0` — `0` is itself meaningful
 * ("reported, nothing cached this call").
 */

export interface UsageMetadataLike {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { cache_read?: number };
  output_token_details?: { reasoning?: number };
}

export interface TokenUsageLike {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ExtractedUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  reasoningTokens: number | null;
  /**
   * Prompt-caching plan D7: tokens WRITTEN to the provider cache this call (billed 1.25x/2x). LangChain's
   * `usage_metadata` has no write field and drops the raw usage — it comes from the raw provider response
   * (`prompt_tokens_details.cache_write_tokens`, OpenRouter's shape), see `rawUsageOf`. Null = unreported.
   */
  cacheWriteTokens: number | null;
}

const NULL_USAGE: ExtractedUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  reasoningTokens: null,
  cacheWriteTokens: null,
};

/** Where model.factory's `__includeRawResponse` puts the provider's whole response on the AIMessage. */
export const RAW_RESPONSE_KEY = '__raw_response';

/** The raw provider `usage` cache-write count; null when the response, the usage or the field is absent/malformed. */
export function cacheWriteTokensOf(additionalKwargs: Record<string, unknown> | undefined): number | null {
  const raw = additionalKwargs?.[RAW_RESPONSE_KEY] as { usage?: unknown } | undefined;
  const usage = raw?.usage as { prompt_tokens_details?: { cache_write_tokens?: unknown } } | undefined;
  const written = usage?.prompt_tokens_details?.cache_write_tokens;
  return typeof written === 'number' && Number.isFinite(written) && written >= 0 ? written : null;
}

/**
 * The raw provider response is only carried to let the extractors above read it — it must not travel on (the
 * agent node's AIMessage is checkpointed). Drops it in place; safe on any message.
 */
export function stripRawResponse(message: { additional_kwargs?: Record<string, unknown> }): void {
  if (message.additional_kwargs && RAW_RESPONSE_KEY in message.additional_kwargs) {
    delete message.additional_kwargs[RAW_RESPONSE_KEY];
  }
}

export function extractUsage(
  usageMetadata: UsageMetadataLike | null | undefined,
  tokenUsage: TokenUsageLike | null | undefined,
  cacheWriteTokens: number | null = null,
): ExtractedUsage {
  if (usageMetadata && typeof usageMetadata.input_tokens === 'number') {
    return {
      inputTokens: usageMetadata.input_tokens,
      outputTokens: typeof usageMetadata.output_tokens === 'number' ? usageMetadata.output_tokens : null,
      cacheReadTokens:
        typeof usageMetadata.input_token_details?.cache_read === 'number'
          ? usageMetadata.input_token_details.cache_read
          : null,
      reasoningTokens:
        typeof usageMetadata.output_token_details?.reasoning === 'number'
          ? usageMetadata.output_token_details.reasoning
          : null,
      cacheWriteTokens,
    };
  }
  if (tokenUsage && (typeof tokenUsage.promptTokens === 'number' || typeof tokenUsage.completionTokens === 'number')) {
    return {
      inputTokens: typeof tokenUsage.promptTokens === 'number' ? tokenUsage.promptTokens : null,
      outputTokens: typeof tokenUsage.completionTokens === 'number' ? tokenUsage.completionTokens : null,
      cacheReadTokens: null,
      reasoningTokens: null,
      cacheWriteTokens,
    };
  }
  return NULL_USAGE;
}

interface LlmResultLike {
  generations?: Array<
    Array<{ message?: { usage_metadata?: UsageMetadataLike; additional_kwargs?: Record<string, unknown> } }>
  >;
  llmOutput?: { tokenUsage?: TokenUsageLike };
}

/** run-metrics.ts / llm-log-handler.ts: both see LangChain's raw `handleLLMEnd` output shape. */
export function extractUsageFromLLMResult(output: LlmResultLike): ExtractedUsage {
  const message = output.generations?.[0]?.[0]?.message;
  return extractUsage(
    message?.usage_metadata,
    output.llmOutput?.tokenUsage,
    cacheWriteTokensOf(message?.additional_kwargs),
  );
}

interface MessageLike {
  usage_metadata?: UsageMetadataLike;
  additional_kwargs?: Record<string, unknown>;
  // `Record<string, unknown>`, not a narrow shape: AIMessage's real `response_metadata` type
  // (LangChain's `ResponseMetadata`) has no declared `tokenUsage` field of its own — providers
  // attach it ad hoc — so a narrower type here makes TS reject a real AIMessage as "no properties
  // in common".
  response_metadata?: Record<string, unknown>;
}

/** agent.node.ts: sees the resolved AIMessage directly, no `llmOutput` wrapper. */
export function extractUsageFromMessage(message: MessageLike): ExtractedUsage {
  const tokenUsage = message.response_metadata?.['tokenUsage'] as TokenUsageLike | undefined;
  return extractUsage(message.usage_metadata, tokenUsage, cacheWriteTokensOf(message.additional_kwargs));
}
