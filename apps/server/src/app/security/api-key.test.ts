import { buildServer } from '@app/server';

describe('X-Api-Key security', () => {
  const app = buildServer();
  const validKey = 'test-key';

  beforeAll(() => {
    process.env.BOT_API_KEY = validKey;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 when header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/user',
      payload: { provider: 'tg', providerUserId: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when key is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/user',
      headers: { 'x-api-key': 'wrong' },
      payload: { provider: 'tg', providerUserId: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows request when key is valid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/user',
      headers: { 'x-api-key': validKey },
      payload: { provider: 'tg', providerUserId: 'x' },
    });
    expect(res.statusCode).toBe(200);
  });
});


