import { buildServer } from '../../../src/app/server';
import { CoreError, LlmUnavailableError, ThreadBusyError } from '../../../src/domain/conversation/errors';
import { CONVERSATION_RUN_PORT_TOKEN } from '../../../src/domain/conversation/ports';
import { TRAINING_SERVICE_TOKEN } from '../../../src/domain/training/ports';
import { USER_SERVICE_TOKEN } from '../../../src/domain/user/ports';
import { getGlobalContainer, registerInfraServices } from '../../../src/main/register-infra-services';

// AC-1352 / INV-LLM-006: the route maps typed conversation errors (D-B) to
// HTTP status + a body carrying only `code` — never the exception message or
// a stack. Follows the chat.routes.integration.test.ts harness (buildServer +
// app.inject, CONVERSATION_RUN_PORT_TOKEN overridden in the container).
const SENTINEL = 'SENTINEL_DO_NOT_LEAK_bd41f0';

describe('POST /api/bot/chat error mapping — AC-1352, INV-LLM-006', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  const stubRun = {
    run: jest.fn(),
    clearContext: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const container = getGlobalContainer();
    await registerInfraServices(container);
    app = buildServer();
    container.register(CONVERSATION_RUN_PORT_TOKEN, stubRun);

    app.decorate('services', {
      userService: container.get(USER_SERVICE_TOKEN) as never,
      trainingService: container.get(TRAINING_SERVICE_TOKEN) as never,
      conversationRun: container.get(CONVERSATION_RUN_PORT_TOKEN) as never,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    stubRun.run.mockReset();
  });

  it('AC-1352: model mocked to throw a provider error → HTTP 503, body deep-equals { error: { code: LLM_UNAVAILABLE } }', async () => {
    stubRun.run.mockRejectedValueOnce(new LlmUnavailableError(SENTINEL, new Error(SENTINEL)));

    const res = await app.inject({
      method: 'POST',
      url: '/api/bot/chat',
      headers: { 'x-api-key': process.env.BOT_API_KEY! },
      payload: { userId: 'ac-1352-user', message: 'hi' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: { code: 'LLM_UNAVAILABLE' } });
  });

  it('THREAD_BUSY → HTTP 409, body deep-equals { error: { code: THREAD_BUSY } }', async () => {
    stubRun.run.mockRejectedValueOnce(new ThreadBusyError(SENTINEL));

    const res = await app.inject({
      method: 'POST',
      url: '/api/bot/chat',
      headers: { 'x-api-key': process.env.BOT_API_KEY! },
      payload: { userId: 'ac-1352-user-2', message: 'hi' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'THREAD_BUSY' } });
  });

  it('CORE_ERROR → HTTP 500, body deep-equals { error: { code: CORE_ERROR } }', async () => {
    stubRun.run.mockRejectedValueOnce(new CoreError(SENTINEL));

    const res = await app.inject({
      method: 'POST',
      url: '/api/bot/chat',
      headers: { 'x-api-key': process.env.BOT_API_KEY! },
      payload: { userId: 'ac-1352-user-3', message: 'hi' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'CORE_ERROR' } });
  });

  it.each([
    ['LLM_UNAVAILABLE', () => new LlmUnavailableError(SENTINEL, new Error(SENTINEL))],
    ['THREAD_BUSY', () => new ThreadBusyError(SENTINEL)],
    ['CORE_ERROR', () => new CoreError(SENTINEL)],
  ])(
    'INV-LLM-006: %s response body contains neither the sentinel message nor a stack-frame marker',
    async (_code, makeError) => {
      stubRun.run.mockRejectedValueOnce(makeError());

      const res = await app.inject({
        method: 'POST',
        url: '/api/bot/chat',
        headers: { 'x-api-key': process.env.BOT_API_KEY! },
        payload: { userId: 'inv-llm-006-user', message: 'hi' },
      });

      const rawBody = res.body;
      expect(rawBody).not.toContain(SENTINEL);
      expect(rawBody).not.toContain('at '); // stack-frame marker
    },
  );

  it('AC-1352: the run row records outcome llm_unavailable for a real provider-error throw through the adapter', async () => {
    // Exercise the real adapter (not the stub) so the run row's outcome is
    // proven, not just the route's status mapping. Full unit coverage of the
    // adapter's classification lives in conversation-run.adapter.unit.test.ts;
    // this proves the same classification survives the route round-trip.
    // The route only ever calls app.services.conversationRun (a fixed
    // decorator set once in beforeAll), so the stub's `run` is redirected to
    // the real adapter here instead of re-decorating (Fastify forbids
    // decorating after the app has started).
    const { buildConversationRunner } = await import('../../../src/infra/ai/graph/conversation-run.adapter');
    const userId = 'ac-1352-real-adapter-user';

    const recorded: Array<{ outcome: string; userId: string }> = [];
    const providerError = Object.assign(new Error(SENTINEL), { status: 503 });
    const runner = buildConversationRunner({
      graph: {
        invoke: async () => {
          throw providerError;
        },
      },
      userService: { getUser: async () => ({ id: userId, languageCode: 'en' }) } as never,
      runService: { recordRun: async (record: never) => void recorded.push(record as never) } as never,
      checkpointer: { deleteThread: async () => undefined },
      transcript: { appendRunMessages: async () => undefined, appendSystemNote: async () => undefined } as never,
    });

    stubRun.run.mockImplementationOnce((input: never) => runner.run(input));

    const res = await app.inject({
      method: 'POST',
      url: '/api/bot/chat',
      headers: { 'x-api-key': process.env.BOT_API_KEY! },
      payload: { userId, message: 'hi' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: { code: 'LLM_UNAVAILABLE' } });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].outcome).toBe('llm_unavailable');
  });
});
