import { registerServices } from '@services/di/register';
import { pool } from '@db/db';
import { Container } from '@services/di/injectable';
import { UserService } from '@services/user.service';
import { CreateUserDto } from '@models/user.types';
import { UserDbService } from '@db/services/user-db.service';

import request from 'supertest';
import { app } from '../app';

describe('User API', () => {
  let userService: UserService;
  let testUserId: string;
  let mockUserDb: jest.Mocked<UserDbService>;

  beforeAll(async () => {
    await registerServices();
    const container = Container.getInstance();
    
    // Create mock UserDbService
    mockUserDb = {
      findByProvider: jest.fn(),
      createUser: jest.fn(),
      updateUser: jest.fn(),
      getUserWithAccounts: jest.fn(),
      getUserAccount: jest.fn(),
      getUserByProvider: jest.fn(),
      createUserAccount: jest.fn(),
      updateUserAccount: jest.fn(),
    } as any;

    // Register mock service
    container.register('UserDbService', mockUserDb);
    
    // Wait for UserService to be available
    let retries = 0;
    while (retries < 5) {
      try {
        userService = container.get<UserService>('UserService');
        break;
      } catch (error) {
        retries++;
        if (retries === 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

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

  describe('POST /api/user', () => {
    it('should register new user', async () => {
      const userData: CreateUserDto = {
        provider: 'telegram',
        providerUserId: 'new-user-123',
        firstName: 'New',
        lastName: 'User',
        languageCode: 'en'
      };

      const response = await request(app)
        .post('/api/user')
        .send(userData);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        firstName: userData.firstName,
        lastName: userData.lastName,
        accounts: expect.arrayContaining([
          expect.objectContaining({
            provider: userData.provider,
            providerUserId: userData.providerUserId
          })
        ])
      });
    });

    it('should update existing user', async () => {
      const userData: CreateUserDto = {
        provider: 'telegram',
        providerUserId: 'new-user-123',
        firstName: 'Updated',
        lastName: 'Name',
        languageCode: 'en'
      };

      const response = await request(app)
        .post('/api/user')
        .send(userData);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        firstName: userData.firstName,
        lastName: userData.lastName,
        accounts: expect.arrayContaining([
          expect.objectContaining({
            provider: userData.provider,
            providerUserId: userData.providerUserId
          })
        ])
      });
    });

    it('should return 400 for invalid user data', async () => {
      const invalidData = {
        provider: 'telegram',
        // missing required fields
      };

      const response = await request(app)
        .post('/api/user')
        .send(invalidData);

      expect(response.status).toBe(400);
    });
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