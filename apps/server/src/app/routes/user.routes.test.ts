import { buildServer } from '@app/server';

describe('users routes', () => {
  const app = buildServer();

  afterAll(async () => {
    await app.close();
  });

  it('upsert user returns id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/user',
      payload: { provider: 'tg', providerUserId: 'u1', username: 'john' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('data.id');
  });
});


