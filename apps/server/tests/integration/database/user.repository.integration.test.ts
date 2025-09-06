import { DrizzleUserRepository } from '../../../src/infra/db/repositories/user.repository';
import { db } from '../../../src/infra/db/drizzle';
import { createTestUserData } from '../../shared/test-factories';

/**
 * DrizzleUserRepository Integration Tests
 * Tests real database operations with transaction rollback for isolation
 */
describe('DrizzleUserRepository – integration', () => {
  let repository: DrizzleUserRepository;
  let tx: any; // Transaction context for test isolation

  beforeAll(async() => {
    repository = new DrizzleUserRepository();
  });

  // Note: For database integration tests, we use unique data instead of transactions
  // to avoid complex transaction setup with Drizzle ORM in tests

  describe('create', () => {
    it('should create user with correct data structure and return valid user object', async() => {
      // Arrange
      const userData = createTestUserData({
        username: 'testuser_create',
        firstName: 'Test',
        lastName: 'User',
        languageCode: 'en',
      });

      // Act
      const result = await repository.create(userData);

      // Assert
      expect(result).toHaveProperty('id');
      expect(typeof result.id).toBe('string');
      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(result.username).toBe('testuser_create');
      expect(result.firstName).toBe('Test');
      expect(result.lastName).toBe('User');
      expect(result.languageCode).toBe('en');
      expect(result.profileStatus).toBe('incomplete');
      expect(result).toHaveProperty('id');
    });

    it('should create users with different providers independently', async() => {
      // Arrange
      const userData1 = createTestUserData({
        provider: 'telegram',
        username: 'telegram_user',
      });
      const userData2 = createTestUserData({
        provider: 'discord',
        username: 'discord_user',
      });

      // Act
      const result1 = await repository.create(userData1);
      const result2 = await repository.create(userData2);

      // Assert
      expect(result1.id).not.toBe(result2.id);
      expect(result1.username).toBe('telegram_user');
      expect(result2.username).toBe('discord_user');
    });
  });

  describe('updateProfileData', () => {
    it('should update user profile data and return updated user object', async() => {
      // Arrange
      const createData = createTestUserData({
        username: 'testuser_update',
        firstName: 'Test',
        lastName: 'User',
      });
      const user = await repository.create(createData);

      const profileData = {
        age: 28,
        gender: 'male' as const,
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate' as const,
        fitnessGoal: 'lose weight',
      };

      // Act
      const result = await repository.updateProfileData(user.id, profileData);

      // Assert
      expect(result).toBeTruthy();
      expect(result!.id).toBe(user.id);
      expect(result!.age).toBe(28);
      expect(result!.gender).toBe('male');
      expect(result!.height).toBe(175);
      expect(result!.weight).toBe(75);
      expect(result!.fitnessLevel).toBe('intermediate');
      expect(result!.fitnessGoal).toBe('lose weight');
      expect(result!.profileStatus).toBe('incomplete'); // Profile data updated but not complete yet
    });

    it('should return null when updating non-existent user', async() => {
      // Arrange
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const profileData = {
        age: 25,
        gender: 'female' as const,
        height: 160,
        weight: 55,
        fitnessLevel: 'beginner' as const,
        fitnessGoal: 'gain muscle',
      };

      // Act
      const result = await repository.updateProfileData(nonExistentId, profileData);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle partial profile updates', async() => {
      // Arrange
      const createData = createTestUserData({
        username: 'testuser_partial',
      });
      const user = await repository.create(createData);

      // Only update some fields
      const partialProfileData = {
        age: 30,
        height: 180,
      };

      // Act
      const result = await repository.updateProfileData(user.id, partialProfileData);

      // Assert
      expect(result).toBeTruthy();
      expect(result!.age).toBe(30);
      expect(result!.height).toBe(180);
      // Other fields should remain unchanged
      expect(result!.username).toBe('testuser_partial');
      expect(result!.profileStatus).toBe('incomplete');
    });
  });

  describe('getById', () => {
    it('should retrieve user by ID when user exists', async() => {
      // Arrange
      const createData = createTestUserData({
        username: 'testuser_getbyid',
      });
      const createdUser = await repository.create(createData);

      // Act
      const result = await repository.getById(createdUser.id);

      // Assert
      expect(result).toBeTruthy();
      expect(result!.id).toBe(createdUser.id);
      expect(result!.username).toBe('testuser_getbyid');
    });

    it('should return null when user does not exist', async() => {
      // Arrange
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      // Act
      const result = await repository.getById(nonExistentId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findByProvider', () => {
    it('should find user by provider and providerUserId', async() => {
      // Arrange
      const createData = createTestUserData({
        provider: 'telegram',
        username: 'testuser_findbyprovider',
      });
      const createdUser = await repository.create(createData);

      // Act - we need to use the providerUserId from the original input data
      const result = await repository.findByProvider('telegram', createData.providerUserId);

      // Assert
      expect(result).toBeTruthy();
      expect(result!.id).toBe(createdUser.id);
      expect(result!.username).toBe('testuser_findbyprovider');
    });

    it('should return null when provider account does not exist', async() => {
      // Act
      const result = await repository.findByProvider('telegram', 'nonexistent_user_id');

      // Assert
      expect(result).toBeNull();
    });

    it('should handle different providers correctly', async() => {
      // Arrange
      const telegramData = createTestUserData({
        provider: 'telegram',
        username: 'telegram_find',
      });
      const discordData = createTestUserData({
        provider: 'discord',
        username: 'discord_find',
      });

      const telegramUser = await repository.create(telegramData);
      const discordUser = await repository.create(discordData);

      // Act & Assert - use original providerUserId from input data
      const telegramResult = await repository.findByProvider('telegram', telegramData.providerUserId);
      const discordResult = await repository.findByProvider('discord', discordData.providerUserId);

      expect(telegramResult!.id).toBe(telegramUser.id);
      expect(discordResult!.id).toBe(discordUser.id);
      expect(telegramResult!.username).toBe('telegram_find');
      expect(discordResult!.username).toBe('discord_find');
    });
  });
});
