import { buildServer } from '@app/server';

describe('users routes', () => {
  const app = buildServer();

  const validKey = 'test-key';
  beforeAll(() => {
    process.env.BOT_API_KEY = validKey;
  });

  afterAll(async () => {
    await app.close();
  });

  it('upsert user returns id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/user',
      headers: { 'x-api-key': validKey },
      payload: { provider: 'tg', providerUserId: 'u1', username: 'john' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('data.id');
  });
});


