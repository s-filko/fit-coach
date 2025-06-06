import { registerServices } from '@services/di/register';
import { pool } from '@db/db';
import { Container } from '@services/di/injectable';
import { UserService } from '@services/user.service';
import { CreateUserDto } from '@models/user.types';

// Register services before importing app
registerServices();

import request from 'supertest';
import { app } from '../app';

describe('User API', () => {
  let userService: UserService;
  let testUserId: string;

  beforeAll(async () => {
    const container = Container.getInstance();
    userService = container.resolve(UserService) as UserService;

    // Create a test user
    const userData: CreateUserDto = {
      provider: 'test',
      providerUserId: 'test-123',
      firstName: 'Test',
      lastName: 'User',
      languageCode: 'en'
    };
    const user = await userService.upsertUser(userData);
    testUserId = user.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('GET /api/user/:id', () => {
    it('should return 404 for non-existent user', async () => {
      const response = await request(app).get('/api/user/non-existent-id');
      expect(response.status).toBe(404);
    });

    it('should return user data for existing user', async () => {
      const response = await request(app).get(`/api/user/${testUserId}`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: testUserId,
        firstName: 'Test',
        lastName: 'User',
        accounts: expect.arrayContaining([
          expect.objectContaining({
            provider: 'test',
            providerUserId: 'test-123'
          })
        ])
      });
    });

    it('should return 404 for invalid UUID format', async () => {
      const response = await request(app).get('/api/user/invalid-uuid');
      expect(response.status).toBe(404);
    });
  });
}); 