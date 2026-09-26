/**
 * AC-CA-4 (D7): an attribution failure never fails the call — the row is still inserted, with its
 * usage columns populated and every cache_* column null. Mocking the DB/config here (rather than a
 * real DB) so the failure is forced deterministically: `loadConfig` throwing stands in for "the
 * previous row query throws" — both paths hit the same try/catch in recordLlmCall.
 */
const values = jest.fn().mockResolvedValue(undefined);
const insert = jest.fn((..._args: unknown[]) => ({ values }));

jest.mock('@infra/db/drizzle', () => ({ db: { insert: (...args: unknown[]) => insert(...args) } }));
jest.mock('@infra/db/schema', () => ({ llmCalls: {}, promptBlobs: {} }));
jest.mock('@config/index', () => ({
  loadConfig: () => {
    throw new Error('config boom');
  },
}));

import { recordLlmCall } from '@infra/ai/llm-call-recorder';

describe('recordLlmCall — cache attribution failure never fails the call (AC-CA-4, D7)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts the row with null cache_* columns when attribution throws, usage columns still populated', async () => {
    await expect(
      recordLlmCall({
        runId: 'run-1',
        userId: 'user-1',
        model: 'z-ai/glm-5.3',
        request: { model: 'z-ai/glm-5.3', messages: [{ role: 'user', content: 'следующий подход' }], temperature: 0.7 },
        response: {
          text: 'ok',
          finishReason: 'stop',
          usage: { promptTokens: 100, completionTokens: 10, cacheReadTokens: 0, reasoningTokens: 5 },
        },
        latencyMs: 250,
      }),
    ).resolves.toBeUndefined();

    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        reasoningTokens: 5,
        cacheExpected: null,
        cacheDivergedAt: null,
        cacheSharedPrefixTokens: null,
        cacheGapMs: null,
      }),
    );
  });

  it('no userId at all: attribution is never attempted (no config/DB lookup), same null columns', async () => {
    await recordLlmCall({
      runId: 'run-2',
      userId: null,
      model: 'z-ai/glm-5.3',
      request: { model: 'z-ai/glm-5.3', messages: [{ role: 'user', content: 'привет' }], temperature: 0.7 },
      response: { text: 'ok', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 2 } },
      latencyMs: 100,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheExpected: null,
        cacheDivergedAt: null,
        cacheSharedPrefixTokens: null,
        cacheGapMs: null,
      }),
    );
  });
});
