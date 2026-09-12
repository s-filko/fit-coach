/**
 * The LLM callback handler feeds the run-metrics accumulator (AC-1304 wiring).
 *
 * Root cause found on dev: LangChain strips `configurable` from the options a
 * callback handler sees (`runnables/base.js` `_separateRunnableConfigFromCallOptions`
 * deletes it from callOptions), so reading `extraParams.options.configurable.runId`
 * always yielded undefined — run rows came out model='unknown', tokens 0.
 *
 * The channel that survives is config `metadata`: it is inherited by every nested
 * run and reaches the handler as the 7th argument of handleChatModelStart.
 */

import { drainRunMetrics, startRun } from '@infra/ai/run-metrics';
import { LLMLogHandler } from '@infra/ai/llm-log-handler';

describe('LLMLogHandler — run metrics binding via metadata (AC-1301, ADR-0013 §8)', () => {
  it('binds the conversation runId and records model/tokens when metadata carries runId', () => {
    startRun('run-meta');
    const handler = new LLMLogHandler();

    handler.handleChatModelStart(
      {} as never, // llm serialized
      [[]], // messages
      'lc-call-1', // LangChain per-call run id
      undefined, // parentRunId
      { options: {}, invocation_params: { model: 'z-ai/glm-5.3' } }, // extraParams
      [], // tags
      { runId: 'run-meta', userId: 'u1' }, // metadata
    );

    handler.handleLLMEnd(
      { generations: [[{ text: 'ok' }]], llmOutput: { tokenUsage: { promptTokens: 42, completionTokens: 7 } } },
      'lc-call-1',
    );

    const metrics = drainRunMetrics('run-meta');
    expect(metrics.model).toBe('z-ai/glm-5.3');
    expect(metrics.tokensIn).toBe(42);
    expect(metrics.tokensOut).toBe(7);
    expect(metrics.llmCalls).toBe(1);
  });

  it('does not throw and binds nothing when metadata has no runId', () => {
    const handler = new LLMLogHandler();

    expect(() =>
      handler.handleChatModelStart({} as never, [[]], 'lc-call-2', undefined, { options: {} }, [], {}),
    ).not.toThrow();
    expect(() => handler.handleLLMEnd({ generations: [[{ text: 'ok' }]] }, 'lc-call-2')).not.toThrow();
  });
});
