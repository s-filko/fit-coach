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

  it('upsert returns same id for same provider account', async () => {
    const payload = { provider: 'tg', providerUserId: 'dup1', username: 'jane' };
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/user',
      headers: { 'x-api-key': validKey },
      payload,
    });
    expect(res1.statusCode).toBe(200);
    const id1 = (res1.json() as any).data.id;

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/user',
      headers: { 'x-api-key': validKey },
      payload,
    });
    expect(res2.statusCode).toBe(200);
    const id2 = (res2.json() as any).data.id;

    expect(id2).toBe(id1);
  });

  it('get user by id after create returns same id', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/user',
      headers: { 'x-api-key': validKey },
      payload: { provider: 'tg', providerUserId: 'u-get-1', username: 'kate' },
    });
    expect(create.statusCode).toBe(200);
    const id = (create.json() as any).data.id;

    const get = await app.inject({
      method: 'GET',
      url: `/api/user/${id}`,
      headers: { 'x-api-key': validKey },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ data: { id } });
  });

  it('get non-existing user returns 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/00000000-0000-0000-0000-000000000000',
      headers: { 'x-api-key': validKey },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { message: 'User not found' } });
  });
});


