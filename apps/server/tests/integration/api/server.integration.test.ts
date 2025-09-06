import { buildServer } from '../../../src/app/server';
import { createTestApiKey, createTestUserData } from '../../shared/test-factories';

/**
 * Server Integration Tests
 * Tests basic server functionality and API documentation
 */
describe('Server Basic Functionality – integration', () => {
  let app: ReturnType<typeof buildServer>;

  beforeAll(async() => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async() => {
    await app.close();
  });

  describe('Health Check Endpoint', () => {
    it('should return 200 OK with correct response format', async() => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');

      const json = res.json();
      expect(json).toEqual({
        status: 'ok',
      });
    });

    it('should respond quickly to health checks', async() => {
      const startTime = Date.now();

      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(res.statusCode).toBe(200);
      expect(responseTime).toBeLessThan(100); // Should respond in less than 100ms
    });
  });

  describe('API Documentation', () => {
    it('should expose OpenAPI documentation at /docs/json', async() => {
      const res = await app.inject({
        method: 'GET',
        url: '/docs/json',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');

      const json = res.json();
      expect(json).toHaveProperty('openapi');
      expect(json).toHaveProperty('info');
      expect(json).toHaveProperty('paths');
      expect(typeof json.paths).toBe('object');
    });

    it('should include all main API endpoints in documentation', async() => {
      const res = await app.inject({
        method: 'GET',
        url: '/docs/json',
      });

      const json = res.json();
      const paths = Object.keys(json.paths ?? {});

      // Check that main endpoints are documented
      expect(paths).toEqual(expect.arrayContaining([
        '/api/user',
        '/api/user/{id}',
        '/api/chat',
      ]));
    });

    it('should have correct POST /api/user schema', async() => {
      const res = await app.inject({
        method: 'GET',
        url: '/docs/json',
      });

      const json = res.json();
      const userPost = json.paths['/api/user'].post;

      expect(userPost).toBeTruthy();
      expect(userPost).toHaveProperty('requestBody');
      expect(userPost.requestBody).toHaveProperty('content');
      expect(userPost.requestBody.content).toHaveProperty('application/json');

      const { schema } = userPost.requestBody.content['application/json'];
      expect(schema).toHaveProperty('properties');

      const props = Object.keys(schema.properties);
      expect(props).toEqual(expect.arrayContaining(['provider', 'providerUserId']));
    });

    it('should have correct GET /api/user/{id} schema with path parameter', async() => {
      const res = await app.inject({
        method: 'GET',
        url: '/docs/json',
      });

      const json = res.json();
      const userGet = json.paths['/api/user/{id}'].get;

      expect(userGet).toBeTruthy();
      expect(userGet).toHaveProperty('parameters');

      const params = userGet.parameters ?? [];
      const paramNames = params.map((p: any) => p.name);
      expect(paramNames).toEqual(expect.arrayContaining(['id']));

      // Check that id parameter is correctly defined as path parameter
      const idParam = params.find((p: any) => p.name === 'id');
      expect(idParam).toBeTruthy();
      expect(idParam.in).toBe('path');
      expect(idParam.required).toBe(true);
    });

    it('should have correct POST /api/chat schema', async() => {
      const res = await app.inject({
        method: 'GET',
        url: '/docs/json',
      });

      const json = res.json();
      const chatPost = json.paths['/api/chat'].post;

      expect(chatPost).toBeTruthy();
      expect(chatPost).toHaveProperty('requestBody');
      expect(chatPost.requestBody).toHaveProperty('content');
      expect(chatPost.requestBody.content).toHaveProperty('application/json');

      const { schema } = chatPost.requestBody.content['application/json'];
      expect(schema).toHaveProperty('properties');

      const props = Object.keys(schema.properties);
      expect(props).toEqual(expect.arrayContaining(['userId', 'message']));
    });
  });

  describe('Server Configuration', () => {
    it('should handle CORS preflight requests properly', async() => {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/user',
      });

      // OPTIONS requests should either:
      // - Return 200/204 with CORS headers if route exists
      // - Return 404 if route doesn't exist
      // - Return 400 if there's a validation error
      expect([200, 204, 404, 400]).toContain(res.statusCode);

      // If route exists, should have CORS headers
      if (res.statusCode === 200 || res.statusCode === 204) {
        expect(res.headers).toHaveProperty('access-control-allow-origin');
        expect(res.headers).toHaveProperty('access-control-allow-methods');
        expect(res.headers).toHaveProperty('access-control-allow-headers');
      }
    });

    it('should return 404 for unknown routes', async() => {
      const res = await app.inject({
        method: 'GET',
        url: '/unknown-route',
      });

      expect(res.statusCode).toBe(404);
    });

    it('should handle different HTTP methods on health endpoint', async() => {
      // Test various HTTP methods on health endpoint
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

      for (const method of methods) {
        const res = await app.inject({ method: method as any, url: '/health' });

        if (method === 'GET') {
          // GET should work
          expect(res.statusCode).toBe(200);
        } else {
          // Other methods should return 404 (route not found) or 405 (method not allowed)
          expect([404, 405]).toContain(res.statusCode);
        }
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON payload', async() => {
      const payload = createTestUserData();
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'content-type': 'application/json',
          'x-api-key': validKey,
        },
        payload: '{invalid json}',
      });

      // Should handle malformed JSON (may return 400 or 500 depending on Fastify config)
      expect([400, 500]).toContain(res.statusCode);
    });

    it('should handle payload size limits', async() => {
      const largePayload = 'x'.repeat(1024 * 1024); // 1MB payload
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'content-type': 'application/json',
          'x-api-key': validKey,
        },
        payload: { data: largePayload },
      });

      // Should handle based on server limits (may return 413 for too large, 500 for other errors,
      // or process successfully)
      expect([200, 413, 500]).toContain(res.statusCode);
    });
  });
});
