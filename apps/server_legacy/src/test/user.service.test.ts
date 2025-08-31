import { UserService } from '@services/user.service';
import { CreateUserDto, UserResponseDto } from '@models/user.types';
import { Container } from '@services/di/injectable';
import { registerServices } from '@services/di/register';
import { db } from '@db/db';
import * as schema from '@db/schema';

describe('UserService', () => {
  let userService: UserService;

  beforeAll(async () => {
    await registerServices();
    const container = Container.getInstance();
    userService = container.get<UserService>('UserService');
  });

  beforeEach(async () => {
    // очищаем все таблицы перед каждым тестом
    await truncateAllTables();
  });

  async function truncateAllTables() {
    // порядок важен из-за внешних ключей!
    await db.delete(schema.workoutExercises);
    await db.delete(schema.exerciseLogs);
    await db.delete(schema.workouts);
    await db.delete(schema.userMetrics);
    await db.delete(schema.userAccounts);
    await db.delete(schema.aiSessions);
    await db.delete(schema.coachSettings);
    await db.delete(schema.userMemories);
    await db.delete(schema.trainingContext);
    await db.delete(schema.exercises);
    await db.delete(schema.users);
  }

  describe('upsertUser', () => {
    it('should create new user when not exists', async () => {
      const userData: CreateUserDto = {
        provider: 'telegram',
        providerUserId: '123456',
        firstName: 'Test',
        lastName: 'User',
        languageCode: 'en'
      };

      const result = await userService.upsertUser(userData);

      expect(result).toBeDefined();
      expect(result.firstName).toBe(userData.firstName);
      expect(result.lastName).toBe(userData.lastName);
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0].provider).toBe(userData.provider);
      expect(result.accounts[0].providerUserId).toBe(userData.providerUserId);
    });

    it('should update existing user', async () => {
      const userData: CreateUserDto = {
        provider: 'telegram',
        providerUserId: '123456',
        firstName: 'Test',
        lastName: 'User',
        languageCode: 'en'
      };

      // сначала создаем пользователя
      await userService.upsertUser(userData);

      // затем обновляем его
      const updatedData = { ...userData, firstName: 'Updated', lastName: 'Name' };
      const result = await userService.upsertUser(updatedData);

      expect(result.firstName).toBe('Updated');
      expect(result.lastName).toBe('Name');
    });

    it('should throw error when user creation fails', async () => {
      const invalidData = {} as CreateUserDto;
      await expect(userService.upsertUser(invalidData)).rejects.toThrow();
    });
  });

  describe('getUser', () => {
    it('should return user when exists', async () => {
      const userData: CreateUserDto = {
        provider: 'telegram',
        providerUserId: '123456',
        firstName: 'Test',
        lastName: 'User',
        languageCode: 'en'
      };

      const createdUser = await userService.upsertUser(userData);
      const result = await userService.getUser(createdUser.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(createdUser.id);
    });

    it('should return null for non-existent user', async () => {
      const result = await userService.getUser('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });

    it('should throw error for invalid UUID', async () => {
      await expect(userService.getUser('invalid-uuid')).rejects.toThrow();
    });
  });
}); 