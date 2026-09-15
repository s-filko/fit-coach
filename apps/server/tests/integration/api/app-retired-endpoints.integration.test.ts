import { randomUUID } from 'node:crypto';

import { buildServer } from '../../../src/app/server';
import { CONVERSATION_CONTEXT_SERVICE_TOKEN } from '../../../src/domain/conversation/ports';
import { TRAINING_SERVICE_TOKEN } from '../../../src/domain/training/ports';
import { USER_SERVICE_TOKEN } from '../../../src/domain/user/ports';
import { getGlobalContainer, registerInfraServices } from '../../../src/main/register-infra-services';
import { buildSignedInitData } from '../../helpers/init-data';

const describeIfDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeIfDb('Retired mini-app LLM endpoints (AC-1312, ADR-0013 OQ-1)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let initData: string;

  beforeAll(async () => {
    const container = getGlobalContainer();
    await registerInfraServices(container);
    app = buildServer();
    app.decorate('services', {
      userService: container.get(USER_SERVICE_TOKEN) as never,
      conversationContextService: container.get(CONVERSATION_CONTEXT_SERVICE_TOKEN) as never,
      trainingService: container.get(TRAINING_SERVICE_TOKEN) as never,
      conversationGraph: { invoke: jest.fn() } as never,
    });
    await app.ready();
    initData = buildSignedInitData(process.env.TELEGRAM_TOKEN!);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/app/plan still enforces auth first (401 without initData)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/app/plan', payload: { goal: 'strength', daysPerWeek: 3 } });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/app/plan returns 410 RETIRED for an authenticated caller', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/app/plan',
      headers: { 'x-init-data': initData },
      payload: { goal: 'strength', daysPerWeek: 3 },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ error: { code: 'RETIRED' } });
  });

  it('POST /api/app/session/:id/recommend still enforces auth first (401 without initData)', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/app/session/${randomUUID()}/recommend`, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/app/session/:id/recommend returns 410 RETIRED without reading the session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/app/session/${randomUUID()}/recommend`,
      headers: { 'x-init-data': initData },
      payload: { comment: 'more legs' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ error: { code: 'RETIRED' } });
  });
});
