import { buildServer } from '../../../src/app/server';
import { db } from '../../../src/infra/db/drizzle';
import { createTestApiKey, createTestUserData } from '../../shared/test-factories';

describe('API Key Authentication Middleware – integration', () => {
  let app: ReturnType<typeof buildServer>;
  let tx: any;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Note: For API integration tests, we don't use transactions as they test the full stack
  // Data cleanup is handled by the test data factories with unique IDs

  describe('X-Api-Key header validation', () => {
    it('should return 401 when x-api-key header is missing', async () => {
      const payload = createTestUserData();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        // No x-api-key header
        payload,
      });

      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain('application/json');

      const json = res.json();
      expect(json).toHaveProperty('error');
      expect(json.error).toHaveProperty('message');
    });

    it('should return 403 when x-api-key is invalid', async () => {
      const payload = createTestUserData();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: { 'x-api-key': 'invalid-api-key' },
        payload,
      });

      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toContain('application/json');

      const json = res.json();
      expect(json).toHaveProperty('error');
      expect(json.error).toHaveProperty('message');
    });

    it('should handle empty x-api-key', async () => {
      const payload = createTestUserData();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: { 'x-api-key': '' },
        payload,
      });

      // Empty API key should be treated as missing/invalid
      expect([401, 403]).toContain(res.statusCode);
      const json = res.json();
      expect(json).toHaveProperty('error');
    });

    it('should allow request when x-api-key is valid', async () => {
      const payload = createTestUserData();
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: { 'x-api-key': validKey },
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');

      const json = res.json();
      expect(json).toHaveProperty('data');
      expect(json.data).toHaveProperty('id');
    });
  });

  describe('case sensitivity', () => {
    it('should accept x-api-key in lowercase', async () => {
      const payload = createTestUserData();
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: { 'x-api-key': validKey },
        payload,
      });

      expect(res.statusCode).toBe(200);
    });

    it('should accept X-Api-Key in title case', async () => {
      const payload = createTestUserData();
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: { 'X-Api-Key': validKey },
        payload,
      });

      expect(res.statusCode).toBe(200);
    });

    it('should accept X-API-KEY in uppercase', async () => {
      const payload = createTestUserData();
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: { 'X-API-KEY': validKey },
        payload,
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('multiple endpoints protection', () => {
    it('should protect POST /api/user endpoint', async () => {
      const payload = createTestUserData();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        // No header
        payload,
      });

      expect(res.statusCode).toBe(401);
    });

    it('should protect GET /api/user/{id} endpoint', async () => {
      const userId = '00000000-0000-0000-0000-000000000000';

      const res = await app.inject({
        method: 'GET',
        url: `/api/user/${userId}`,
        // No header
      });

      expect(res.statusCode).toBe(401);
    });

    it('should protect POST /api/chat endpoint', async () => {
      const payload = {
        userId: 'test-user',
        message: 'Hello'
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        // No header
        payload,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('public endpoints', () => {
    it('should allow GET /health without api key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        // No header needed for public endpoints
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
