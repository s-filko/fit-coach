/**
 * POST /chat/compact (manual compaction): the route talks to the run port
 * only, behind the same X-Api-Key guard and with the same typed error mapping
 * as /chat (INV-LLM-006 — the body carries only `code`). A stub port and no
 * database: the DB-backed route suite lives in tests/integration.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';

import { registerErrorHandler } from '@app/middlewares/error';
import botSecurityPlugin from '@app/plugins/bot-security.plugin';
import chatRoutesPlugin from '@app/plugins/chat-routes.plugin';

import { CoreError, LlmUnavailableError, ThreadBusyError } from '@domain/conversation/ports';

import { loadConfig } from '@config/index';

const compact = jest.fn();

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  app.decorate('services', { conversationRun: { compact } } as never);
  await app.register(
    async instance => {
      await instance.register(botSecurityPlugin);
      await instance.register(chatRoutesPlugin);
    },
    { prefix: '/api/bot' },
  );
  await app.ready();
  return app;
}

describe('POST /api/bot/chat/compact', () => {
  let app: FastifyInstance;
  const headers = () => ({ 'x-api-key': loadConfig().BOT_API_KEY as string });

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    compact.mockReset();
  });

  const call = (payload: unknown, h: Record<string, string> = headers()) =>
    app.inject({ method: 'POST', url: '/api/bot/chat/compact', headers: h, payload: payload as never });

  it.each(['compacted', 'nothing_to_compact'] as const)('returns the port outcome (%s)', async outcome => {
    compact.mockResolvedValue(outcome);

    const res = await call({ userId: 'u1' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { outcome } });
    expect(compact).toHaveBeenCalledWith('u1');
  });

  it('rejects a missing key (401) and a wrong key (403) before the port is touched', async () => {
    expect((await call({ userId: 'u1' }, {})).statusCode).toBe(401);
    expect((await call({ userId: 'u1' }, { 'x-api-key': 'nope' })).statusCode).toBe(403);
    expect(compact).not.toHaveBeenCalled();
  });

  it('rejects an empty userId (400)', async () => {
    expect((await call({ userId: '' })).statusCode).toBe(400);
    expect(compact).not.toHaveBeenCalled();
  });

  it.each([
    [new LlmUnavailableError('secret provider detail'), 503, 'LLM_UNAVAILABLE'],
    [new ThreadBusyError('secret detail'), 409, 'THREAD_BUSY'],
    [new CoreError('secret detail'), 500, 'CORE_ERROR'],
    [new Error('secret detail'), 500, 'CORE_ERROR'],
  ])('maps %p to %i with a code-only body', async (err, status, code) => {
    compact.mockRejectedValue(err);

    const res = await call({ userId: 'u1' });

    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: { code } });
    expect(res.body).not.toContain('secret');
  });
});
