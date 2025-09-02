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

  it('docs include user and chat routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const json = res.json() as any;
    const paths = Object.keys(json.paths || {});
    expect(paths).toEqual(expect.arrayContaining(['/api/user', '/api/user/{id}', '/api/chat']));
    const userPost = json.paths['/api/user'].post;
    expect(userPost.requestBody).toBeTruthy();
    const schema = userPost.requestBody.content['application/json'].schema;
    const props = schema.properties || {};
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['provider', 'providerUserId']));

    // GET /api/user/{id} must have path param id
    const userGet = json.paths['/api/user/{id}'].get;
    const params = userGet.parameters || [];
    expect(params.map((p: any) => p.name)).toEqual(expect.arrayContaining(['id']));

    // POST /api/chat must have body with userId and message
    const chatPost = json.paths['/api/chat'].post;
    expect(chatPost.requestBody).toBeTruthy();
    const chatSchema = chatPost.requestBody.content['application/json'].schema;
    const chatProps = chatSchema.properties || {};
    expect(Object.keys(chatProps)).toEqual(expect.arrayContaining(['userId', 'message']));
  });
});


