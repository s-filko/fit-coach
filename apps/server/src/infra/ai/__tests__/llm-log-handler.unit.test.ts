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

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

import { buildReplayPayload, LLMLogHandler } from '@infra/ai/llm-log-handler';

import { loadConfig } from '@config/index';

describe('LLMLogHandler — logging (metrics live in the collector) and the AC-AT-3 record, DB-free here', () => {
  it('logs a model start/end without touching any metrics state', async () => {
    const recordCall = jest.fn().mockResolvedValue(undefined);
    const handler = new LLMLogHandler(recordCall);

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
    await expect(
      handler.handleLLMEnd(
        { generations: [[{ text: 'ok' }]], llmOutput: { tokenUsage: { promptTokens: 42, completionTokens: 7 } } },
        'lc-call-1',
      ),
    ).resolves.toBeUndefined();
    // metadata carried a runId — the call was recorded (via the injected stub, never the real DB).
    expect(recordCall).toHaveBeenCalledTimes(1);
    expect(recordCall.mock.calls[0][0]).toMatchObject({ runId: 'run-meta', model: 'z-ai/glm-5.3' });
  });

  it('does not throw when metadata has no runId, and records nothing (no run to attribute it to)', async () => {
    const recordCall = jest.fn().mockResolvedValue(undefined);
    const handler = new LLMLogHandler(recordCall);

    expect(() =>
      handler.handleChatModelStart({} as never, [[]], 'lc-call-2', undefined, { options: {} }, [], {}),
    ).not.toThrow();
    await expect(handler.handleLLMEnd({ generations: [[{ text: 'ok' }]] }, 'lc-call-2')).resolves.toBeUndefined();
    expect(recordCall).not.toHaveBeenCalled();
  });

  it('AC-AT-3 D-F-style: a recorder that throws is logged and swallowed, never rejects', async () => {
    const recordCall = jest.fn().mockRejectedValue(new Error('db down'));
    const handler = new LLMLogHandler(recordCall);

    handler.handleChatModelStart({} as never, [[]], 'lc-call-3', undefined, { options: {} }, [], { runId: 'run-3' });
    await expect(handler.handleLLMEnd({ generations: [[{ text: 'ok' }]] }, 'lc-call-3')).resolves.toBeUndefined();
    expect(recordCall).toHaveBeenCalledTimes(1);
  });

  it('AC-AT-3: a failing call still records the request, with the error and no response', async () => {
    const recordCall = jest.fn().mockResolvedValue(undefined);
    const handler = new LLMLogHandler(recordCall);

    handler.handleChatModelStart(
      {} as never,
      [[]],
      'lc-call-4',
      undefined,
      { options: {}, invocation_params: { model: 'z-ai/glm-5.3' } },
      [],
      { runId: 'run-4' },
    );
    await handler.handleLLMError(new Error('upstream timeout'), 'lc-call-4');

    expect(recordCall).toHaveBeenCalledTimes(1);
    const [[record]] = recordCall.mock.calls;
    expect(record.runId).toBe('run-4');
    expect(record.response).toBeNull();
    expect(record.errorClass).toBe('Error');
    expect(record.errorMessage).toBe('upstream timeout');
  });

  it('AC-AT-3: never stores credentials — a model configured with an API key leaks it nowhere in the built payload', () => {
    const SECRET = 'sk-SECRET-TEST-VALUE-do-not-store-abc123';
    // A real ChatOpenAI, not a stub: invocationParams() is the SAME method LangChain
    // calls to build extraParams.invocation_params for the callback — proving the
    // upstream contract, not just this function's own blindness to a field it never reads.
    const model = new ChatOpenAI({
      apiKey: SECRET,
      model: 'gpt-4o-mini',
      configuration: { baseURL: `https://example.invalid/v1?token=${SECRET}` },
    });
    const invocationParams = model.invocationParams({ tools: [] } as never);

    const payload = buildReplayPayload(
      [new SystemMessage('You are the coach.'), new HumanMessage('привет')],
      { options: { tools: [] }, invocation_params: invocationParams },
      loadConfig(),
    );

    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(JSON.stringify(model.apiKey)).toContain(SECRET); // fixture soundness: the key really is set on the model
  });
});
