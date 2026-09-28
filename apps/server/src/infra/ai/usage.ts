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
}

const NULL_USAGE: ExtractedUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  reasoningTokens: null,
};

export function extractUsage(
  usageMetadata: UsageMetadataLike | null | undefined,
  tokenUsage: TokenUsageLike | null | undefined,
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
    };
  }
  if (tokenUsage && (typeof tokenUsage.promptTokens === 'number' || typeof tokenUsage.completionTokens === 'number')) {
    return {
      inputTokens: typeof tokenUsage.promptTokens === 'number' ? tokenUsage.promptTokens : null,
      outputTokens: typeof tokenUsage.completionTokens === 'number' ? tokenUsage.completionTokens : null,
      cacheReadTokens: null,
      reasoningTokens: null,
    };
  }
  return NULL_USAGE;
}

interface LlmResultLike {
  generations?: Array<Array<{ message?: { usage_metadata?: UsageMetadataLike } }>>;
  llmOutput?: { tokenUsage?: TokenUsageLike };
}

/** run-metrics.ts / llm-log-handler.ts: both see LangChain's raw `handleLLMEnd` output shape. */
export function extractUsageFromLLMResult(output: LlmResultLike): ExtractedUsage {
  const message = output.generations?.[0]?.[0]?.message;
  return extractUsage(message?.usage_metadata, output.llmOutput?.tokenUsage);
}

interface MessageLike {
  usage_metadata?: UsageMetadataLike;
  // `Record<string, unknown>`, not a narrow shape: AIMessage's real `response_metadata` type
  // (LangChain's `ResponseMetadata`) has no declared `tokenUsage` field of its own — providers
  // attach it ad hoc — so a narrower type here makes TS reject a real AIMessage as "no properties
  // in common".
  response_metadata?: Record<string, unknown>;
}

/** agent.node.ts: sees the resolved AIMessage directly, no `llmOutput` wrapper. */
export function extractUsageFromMessage(message: MessageLike): ExtractedUsage {
  const tokenUsage = message.response_metadata?.['tokenUsage'] as TokenUsageLike | undefined;
  return extractUsage(message.usage_metadata, tokenUsage);
}
