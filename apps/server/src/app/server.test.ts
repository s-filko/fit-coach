import { buildServer } from './server';

describe('server basic', () => {
  const app = buildServer();

  afterAll(async () => {
    await app.close();
  });

  it('health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});


