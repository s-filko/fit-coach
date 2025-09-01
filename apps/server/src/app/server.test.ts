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

  it('docs include user and message routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const json = res.json() as any;
    const paths = Object.keys(json.paths || {});
    expect(paths).toEqual(expect.arrayContaining(['/api/user', '/api/user/{id}', '/api/message']));
    const userPost = json.paths['/api/user'].post;
    expect(userPost.requestBody).toBeTruthy();
    const schema = userPost.requestBody.content['application/json'].schema;
    const props = schema.properties || {};
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['provider', 'providerUserId']));

    // GET /api/user/{id} must have path param id
    const userGet = json.paths['/api/user/{id}'].get;
    const params = userGet.parameters || [];
    expect(params.map((p: any) => p.name)).toEqual(expect.arrayContaining(['id']));

    // POST /api/message must have body with userId and message
    const messagePost = json.paths['/api/message'].post;
    expect(messagePost.requestBody).toBeTruthy();
    const msgSchema = messagePost.requestBody.content['application/json'].schema;
    const msgProps = msgSchema.properties || {};
    expect(Object.keys(msgProps)).toEqual(expect.arrayContaining(['userId', 'message']));
  });
});


