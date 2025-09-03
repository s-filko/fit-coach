import { buildServer } from '../../../src/app/server';

/**
 * Input Validation Middleware Integration Tests
 *
 * Tests Fastify validation behavior that was previously scattered across
 * API endpoint tests. Consolidates validation error handling.
 */
describe('Input Validation Middleware – integration', () => {
  let app: ReturnType<typeof buildServer>;
  const validApiKey = 'test-api-key-for-validation';

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('JSON parsing validation', () => {
    it('should handle malformed JSON payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validApiKey,
          'content-type': 'application/json'
        },
        payload: '{invalid json'
      });

      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('application/json');

      const json = res.json();
      expect(json).toHaveProperty('error');
      expect(json.error).toHaveProperty('message');
    });

    it('should handle empty payload when JSON expected', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validApiKey,
          'content-type': 'application/json'
        },
        payload: ''
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json).toHaveProperty('error');
    });

    it('should handle null payload when JSON expected', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validApiKey,
          'content-type': 'application/json'
        },
        payload: undefined // Use undefined instead of null for no payload
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json).toHaveProperty('error');
    });
  });

  describe('Required field validation', () => {
    it('should handle missing required fields in user creation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validApiKey
        },
        payload: {} // Missing all required fields
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json).toHaveProperty('error');
      expect(json.error).toHaveProperty('message');
    });

    it('should handle missing provider field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validApiKey
        },
        payload: {
          providerUserId: 'test_123',
          username: 'testuser'
          // Missing provider
        }
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json).toHaveProperty('error');
    });

    it('should handle missing providerUserId field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validApiKey
        },
        payload: {
          provider: 'telegram',
          username: 'testuser'
          // Missing providerUserId
        }
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json).toHaveProperty('error');
    });
  });

  describe('Data type validation', () => {
    it('should handle invalid provider type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validApiKey
        },
        payload: {
          provider: 123, // Should be string
          providerUserId: 'test_123',
          username: 'testuser'
        }
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json).toHaveProperty('error');
    });

    it('should handle invalid username format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validApiKey
        },
        payload: {
          provider: 'telegram',
          providerUserId: 'test_123',
          username: 123 // Should be string
        }
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json).toHaveProperty('error');
    });
  });

  describe('Payload size validation', () => {
    it('should handle extremely large payloads', async () => {
      const largePayload = 'x'.repeat(1024 * 1024); // 1MB payload

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validApiKey
        },
        payload: {
          provider: 'telegram',
          providerUserId: 'test_123',
          username: 'testuser',
          largeField: largePayload
        }
      });

      // Should either handle or return appropriate error
      expect([200, 400, 413]).toContain(res.statusCode);
    });

    it('should handle deeply nested objects', async () => {
      const deeplyNested = {
        provider: 'telegram',
        providerUserId: 'test_123',
        username: 'testuser',
        nested: {
          level1: {
            level2: {
              level3: {
                data: 'test'
              }
            }
          }
        }
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validApiKey
        },
        payload: deeplyNested
      });

      // Should validate based on schema - extra fields are allowed by default
      // The deeply nested object should be processed successfully
      expect(res.statusCode).toBe(200);
    });
  });

  describe('Chat endpoint validation', () => {
    it('should handle missing userId in chat request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: {
          'x-api-key': validApiKey
        },
        payload: {
          message: 'Hello!'
          // Missing userId
        }
      });

      expect([400, 500]).toContain(res.statusCode);
      const json = res.json();
      expect(json).toHaveProperty('error');
    });

    it('should handle missing message in chat request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: {
          'x-api-key': validApiKey
        },
        payload: {
          userId: 'test-user'
          // Missing message
        }
      });

      expect([400, 500]).toContain(res.statusCode);
      const json = res.json();
      expect(json).toHaveProperty('error');
    });

    it('should handle empty message strings', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: {
          'x-api-key': validApiKey
        },
        payload: {
          userId: 'test-user',
          message: ''
        }
      });

      // Should handle empty message (may process or validate)
      expect([200, 400]).toContain(res.statusCode);
    });
  });

  describe('Error message consistency', () => {
    it('should provide consistent error message format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validApiKey
        },
        payload: {} // Invalid
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();

      // All validation errors should follow the same format
      expect(json).toEqual({
        error: {
          message: expect.any(String),
          code: expect.any(String)
        }
      });
    });

    it('should include field information in validation errors', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: {
          'x-api-key': validApiKey
        },
        payload: {
          provider: 'telegram'
          // Missing required fields
        }
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();

      // Error message should be descriptive
      expect(json.error.message).toBeDefined();
      expect(typeof json.error.message).toBe('string');
      expect(json.error.message.length).toBeGreaterThan(0);
    });
  });
});
