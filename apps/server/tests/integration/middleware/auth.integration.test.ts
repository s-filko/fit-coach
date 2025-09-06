import { buildServer } from '../../../src/app/server';
import { getGlobalContainer, registerInfraServices } from '../../../src/main/register-infra-services';
import { createTestApiKey } from '../../shared/test-factories';

/**
 * API Key Authentication Middleware Integration Tests
 *
 * This file consolidates ALL API key authentication tests that were previously
 * duplicated across multiple API endpoints. Following TESTING.md guidelines:
 * - Middleware logic tested in dedicated middleware tests only
 * - No duplication of auth tests in individual API endpoints
 * - Clear separation of authentication concerns
 */
describe('API Key Authentication Middleware – integration', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async() => {
    // Initialize container and register services
    const container = getGlobalContainer();
    await registerInfraServices(container);
    
    app = await buildServer(container);
    await app.ready();
  });

  afterAll(async() => {
    await app.close();
  });

  describe('X-API-Key header validation', () => {
    it('should return 401 when x-api-key header is missing', async() => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        payload: {
          provider: 'telegram',
          providerUserId: 'test_123',
          username: 'testuser',
        },
        // Intentionally omitting x-api-key header
      });

      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain('application/json');

      const json = res.json();
      expect(json).toHaveProperty('error');
      expect(json.error).toHaveProperty('message');
    });

    it('should return 403 when x-api-key is invalid', async() => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': 'invalid-api-key',
        },
        payload: {
          provider: 'telegram',
          providerUserId: 'test_123',
          username: 'testuser',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toContain('application/json');

      const json = res.json();
      expect(json).toHaveProperty('error');
      expect(json.error).toHaveProperty('message');
    });

    it('should return 401 when x-api-key is empty', async() => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': '',
        },
        payload: {
          provider: 'telegram',
          providerUserId: 'test_123',
          username: 'testuser',
        },
      });

      expect(res.statusCode).toBe(401); // Empty key is treated as missing
      const json = res.json();
      expect(json).toHaveProperty('error');
    });

    it('should allow request when x-api-key is valid', async() => {
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validKey,
        },
        payload: {
          provider: 'telegram',
          providerUserId: `test_${Date.now()}_${Math.random()}`,
          username: `testuser_${Date.now()}_${Math.random()}`,
        },
      });

      // Should not return 401 or 403 (auth errors)
      // May return 200 (success) or 400 (validation error) but NOT auth errors
      expect([200, 400]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });
  });

  describe('Case sensitivity', () => {
    it('should accept x-api-key in lowercase', async() => {
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validKey,
        },
        payload: {
          provider: 'telegram',
          providerUserId: `test_${Date.now()}_${Math.random()}`,
          username: `testuser_${Date.now()}_${Math.random()}`,
        },
      });

      expect([200, 400]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });

    it('should accept X-Api-Key in title case', async() => {
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'X-Api-Key': validKey,
        },
        payload: {
          provider: 'telegram',
          providerUserId: `test_${Date.now()}_${Math.random()}`,
          username: `testuser_${Date.now()}_${Math.random()}`,
        },
      });

      expect([200, 400]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });

    it('should accept X-API-KEY in uppercase', async() => {
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'X-API-KEY': validKey,
        },
        payload: {
          provider: 'telegram',
          providerUserId: `test_${Date.now()}_${Math.random()}`,
          username: `testuser_${Date.now()}_${Math.random()}`,
        },
      });

      expect([200, 400]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });
  });

  describe('Multiple endpoints protection', () => {
    const endpoints = [
      { method: 'POST' as const, url: '/api/user' },
      { method: 'GET' as const, url: '/api/user/550e8400-e29b-41d4-a716-446655440000' },
      { method: 'POST' as const, url: '/api/chat' },
    ];

    endpoints.forEach(({ method, url }) => {
      it(`should protect ${method} ${url} endpoint`, async() => {
        const res = await app.inject({
          method,
          url,
          payload: method === 'POST' ? {
            provider: 'telegram',
            providerUserId: `test_${Date.now()}_${Math.random()}`,
            userId: '550e8400-e29b-41d4-a716-446655440000',
            message: 'test message',
          } : undefined,
        });

        // Should require authentication
        expect([401, 403]).toContain(res.statusCode);
      });
    });
  });

  describe('Public endpoints (should not require auth)', () => {
    const publicEndpoints = [
      { method: 'GET' as const, url: '/health' },
      { method: 'GET' as const, url: '/docs/json' },
      { method: 'GET' as const, url: '/test' },
      { method: 'GET' as const, url: '/test-config' },
      { method: 'GET' as const, url: '/test-di' },
      { method: 'GET' as const, url: '/test-user' },
      { method: 'POST' as const, url: '/test-parser' },
      { method: 'POST' as const, url: '/test-llm' },
      { method: 'POST' as const, url: '/test-save-mock' },
      { method: 'POST' as const, url: '/test-profile-save' },
      { method: 'POST' as const, url: '/test-parser-mock' },
      { method: 'POST' as const, url: '/test-registration-flow' },
    ];

    publicEndpoints.forEach(({ method, url }) => {
      it(`should allow ${method} ${url} without api key`, async() => {
        const res = await app.inject({
          method,
          url,
          payload: method === 'POST' ? {
            message: 'test',
            userId: 'test-user',
            mockParsedData: {},
          } : undefined,
        });

        // Should not return auth errors
        expect(res.statusCode).not.toBe(401);
        expect(res.statusCode).not.toBe(403);
      });
    });
  });

  describe('OPTIONS requests (CORS preflight)', () => {
    it('should allow OPTIONS requests without api key', async() => {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/user',
      });

      // OPTIONS should not require auth
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });

    it('should handle OPTIONS for all API endpoints', async() => {
      const endpoints = ['/api/user', '/api/chat'];

      for (const url of endpoints) {
        const res = await app.inject({
          method: 'OPTIONS',
          url,
        });

        expect(res.statusCode).not.toBe(401);
        expect(res.statusCode).not.toBe(403);
      }
    });
  });
});
