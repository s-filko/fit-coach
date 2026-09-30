/**
 * Prompt-caching plan (BUG-051) T2 — AC-PC-7 (D7), DB-free half: cache WRITE tokens
 * (`prompt_tokens_details.cache_write_tokens`, OpenRouter's shape from the T1 probe) reach the recorder input
 * and the run rollup. Checked END TO END through a real ChatOpenAI (capturing fetch answering with the
 * provider payload) with `LLMLogHandler` attached — FINDING: for a non-streaming call LangChain 1.2.9 drops
 * the raw usage (`response_metadata` carries only `tokenUsage`, `usage_metadata` has `cache_read` but no write
 * field), so T4 must capture the raw usage itself (e.g. a fetch wrapper in model.factory, or
 * `__includeRawResponse`) — where it does is T4's choice; only the observable below is fixed.
 *
 * Interface assumed (T4 implements to it — recorded in the plan § Evidence, T2):
 *  - `RecordLlmCallResponse.usage.cacheWriteTokens?: number | null`, set by `LLMLogHandler.handleLLMEnd`;
 *    null when the provider did not report it, 0 preserved;
 *  - `RunMetricsCollector.onEnd(llmRunId, in, out, cacheRead, reasoning, cacheWrite)` sums into
 *    `snapshot().tokensCacheWrite` (null when no call reported it);
 *  - `ConversationRunRecord.tokensCacheWrite: number | null` → `conversation_runs.tokens_cache_write`.
 */
import { LLMLogHandler } from '@infra/ai/llm-log-handler';
import { RunMetricsCollector } from '@infra/ai/run-metrics';

import { makeCapturingModel } from '../context/__tests__/request-capture';

// The T1 probe's call B: one turn appended, breakpoint moved — 110 tokens written, the earlier prefix read.
const OPENROUTER_USAGE = {
  prompt_tokens: 10437,
  completion_tokens: 20,
  total_tokens: 10457,
  prompt_tokens_details: { cached_tokens: 10302, cache_write_tokens: 110 },
};

const writeOf = (u: unknown): unknown => (u as Record<string, unknown>)['cacheWriteTokens'];

/** One real model call with the handler attached; returns the usage the recorder was handed. */
async function recordedUsage(usage: Record<string, unknown>) {
  const recordCall = jest.fn().mockResolvedValue(undefined);
  const { model } = makeCapturingModel([{ content: 'ok', usage }]);
  await model.invoke('hi', {
    callbacks: [new LLMLogHandler(recordCall)],
    metadata: { runId: 'run-1', userId: 'u1' },
  });
  expect(recordCall).toHaveBeenCalledTimes(1);
  return recordCall.mock.calls[0]![0].response.usage as Record<string, unknown>;
}

describe('AC-PC-7: cache write tokens from the raw provider usage', () => {
  it('AC-PC-7: a real ChatOpenAI call carrying the OpenRouter payload → the recorder gets cache read AND write', async () => {
    const usage = await recordedUsage(OPENROUTER_USAGE);
    expect(usage['cacheReadTokens']).toBe(10302);
    expect(writeOf(usage)).toBe(110);
  });

  it('AC-PC-7: 0 written is preserved as 0; an unreported write is null, never 0', async () => {
    const zero = await recordedUsage({
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
      prompt_tokens_details: { cached_tokens: 100, cache_write_tokens: 0 },
    });
    expect(writeOf(zero)).toBe(0);
    const unreported = await recordedUsage({ prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 });
    expect(writeOf(unreported)).toBeNull();
  });

  it('AC-PC-7: the run rollup sums cache write tokens across calls, null when none reported', () => {
    const collector = new RunMetricsCollector('run-1');
    const snap = () => (collector.snapshot() as unknown as Record<string, unknown>)['tokensCacheWrite'];
    expect(snap()).toBeNull();

    const onEnd = collector.onEnd.bind(collector) as (...a: unknown[]) => void;
    collector.onStart('c1', 'm');
    onEnd('c1', 10000, 10, 0, null, 10302);
    collector.onStart('c2', 'm');
    onEnd('c2', 10437, 20, 10302, null, 110);
    expect(snap()).toBe(10412);
  });
});
