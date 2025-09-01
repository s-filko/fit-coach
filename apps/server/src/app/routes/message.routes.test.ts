import { buildServer } from '@app/server';

describe('message routes', () => {
  const app = buildServer();

  const validKey = 'test-key';

  beforeAll(() => {
    process.env.BOT_API_KEY = validKey;
  });

  afterAll(async () => {
    await app.close();
  });

  it('echoes message with valid api key', async () => {
    const payload = { userId: 'u1', message: 'hello' };
    const res = await app.inject({
      method: 'POST',
      url: '/api/message',
      headers: { 'x-api-key': validKey },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { echo: 'hello' } });
  });
});


