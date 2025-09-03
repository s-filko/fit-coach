import { buildServer } from '../../../src/app/server';
import { db } from '../../../src/infra/db/drizzle';
import { createTestUserData, createTestApiKey } from '../../shared/test-factories';

describe('POST /api/user – integration', () => {
  let app: ReturnType<typeof buildServer>;
  let tx: any; // Transaction context

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Note: For API integration tests, we don't use transactions as they test the full stack
  // Data cleanup is handled by the test data factories with unique IDs

  describe('successful user creation', () => {
    it('should create new user and return user id', async () => {
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
      expect(json).toHaveProperty('data.id');
      expect(typeof json.data.id).toBe('string');
      expect(json.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should return same user id for same provider account (upsert behavior)', async () => {
      const payload = createTestUserData();
      const validKey = createTestApiKey();

      // First request
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: { 'x-api-key': validKey },
        payload,
      });
      expect(res1.statusCode).toBe(200);
      const id1 = res1.json().data.id;

      // Second request with same data
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: { 'x-api-key': validKey },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      const id2 = res2.json().data.id;

      expect(id2).toBe(id1);
    });

    it('should create user with different providers independently', async () => {
      const payload1 = createTestUserData({ provider: 'telegram' });
      const payload2 = createTestUserData({ provider: 'discord' });
      const validKey = createTestApiKey();

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: { 'x-api-key': validKey },
        payload: payload1,
      });
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: { 'x-api-key': validKey },
        payload: payload2,
      });

      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);
      expect(res1.json().data.id).not.toBe(res2.json().data.id);
    });
  });

  describe('error handling', () => {
    it('should handle missing required fields with proper validation error', async () => {
      const validKey = createTestApiKey();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: { 'x-api-key': validKey },
        payload: {}, // Missing required fields
      });

      // Should return 400 for validation errors
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('application/json');

      const json = res.json();
      expect(json).toHaveProperty('error');
      expect(json.error).toHaveProperty('message');
      expect(typeof json.error.message).toBe('string');
      // Should mention missing required fields
      expect(json.error.message.toLowerCase()).toMatch(/provider|provideruserid|required/);
    });

    it('should return 401 when x-api-key header is missing', async () => {
      const payload = createTestUserData();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        // No x-api-key header
        payload,
      });

      expect(res.statusCode).toBe(401);
    });

    it('should return 403 when x-api-key is invalid', async () => {
      const payload = createTestUserData();

      const res = await app.inject({
        method: 'POST',
        url: '/api/user',
        headers: { 'x-api-key': 'invalid-key' },
        payload,
      });

      expect(res.statusCode).toBe(403);
    });
  });
});

describe('GET /api/user/{id} – integration', () => {
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

  it('should return user data when user exists', async () => {
    // First create a user
    const createPayload = createTestUserData();
    const validKey = createTestApiKey();

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/user',
      headers: { 'x-api-key': validKey },
      payload: createPayload,
    });
    expect(createRes.statusCode).toBe(200);
    const userId = createRes.json().data.id;

    // Then get the user
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/user/${userId}`,
      headers: { 'x-api-key': validKey },
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers['content-type']).toContain('application/json');

    const json = getRes.json();
    expect(json).toEqual({
      data: {
        id: userId
      }
    });
  });

  it('should return 404 when user does not exist', async () => {
    const validKey = createTestApiKey();
    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    const res = await app.inject({
      method: 'GET',
      url: `/api/user/${nonExistentId}`,
      headers: { 'x-api-key': validKey },
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');

    const json = res.json();
    expect(json).toEqual({
      error: {
        message: 'User not found'
      }
    });
  });

  it('should return 401 when x-api-key header is missing', async () => {
    const userId = '00000000-0000-0000-0000-000000000000';

    const res = await app.inject({
      method: 'GET',
      url: `/api/user/${userId}`,
      // No x-api-key header
    });

    expect(res.statusCode).toBe(401);
  });
});
