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

import { LLMLogHandler } from '@infra/ai/llm-log-handler';

describe('LLMLogHandler — logging only since run-context-commit (metrics live in the collector)', () => {
  it('logs a model start/end without touching any metrics state', () => {
    const handler = new LLMLogHandler();

    expect(() =>
      handler.handleChatModelStart(
        {} as never,
        [[]],
        'lc-call-1',
        undefined,
        { options: {}, invocation_params: { model: 'z-ai/glm-5.3' } },
        [],
        { runId: 'run-meta', userId: 'u1' },
      ),
    ).not.toThrow();
    expect(() =>
      handler.handleLLMEnd(
        { generations: [[{ text: 'ok' }]], llmOutput: { tokenUsage: { promptTokens: 42, completionTokens: 7 } } },
        'lc-call-1',
      ),
    ).not.toThrow();
  });

  it('does not throw when metadata has no runId', () => {
    const handler = new LLMLogHandler();

    expect(() =>
      handler.handleChatModelStart({} as never, [[]], 'lc-call-2', undefined, { options: {} }, [], {}),
    ).not.toThrow();
    expect(() => handler.handleLLMEnd({ generations: [[{ text: 'ok' }]] }, 'lc-call-2')).not.toThrow();
  });
});
