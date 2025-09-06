import { UserService } from '@domain/user/services/user.service';

import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';

import { createTestUserData } from '../../shared/test-factories';

/**
 * UserService Integration Tests
 * Tests UserService with real DrizzleUserRepository and unique test data
 *
 * According to TESTING.md:
 * - Integration tests use real components (not mocks)
 * - Database operations use unique data for isolation
 * - Tests real service-repository interaction
 */
describe('UserService – integration', () => {
  let userService: UserService;
  let repository: DrizzleUserRepository;

  beforeAll(async() => {
    repository = new DrizzleUserRepository();
    userService = new UserService(repository);
  });

  describe('updateProfileData - real database operations', () => {
    it('should update user profile data in real database', async() => {
      // Arrange: Create a real user in database
      const userData = createTestUserData({
        username: 'profile_update_test',
      });

      const createdUser = await repository.create(userData);

      // Act: Update profile through service (real operation)
      const updateData = {
        age: 30,
        height: 180,
        fitnessLevel: 'intermediate' as const,
      };

      const updatedUser = await userService.updateProfileData(createdUser.id, updateData);

      // Assert: Check actual database state
      expect(updatedUser).toBeTruthy();
      expect(updatedUser!.age).toBe(30);
      expect(updatedUser!.height).toBe(180);
      expect(updatedUser!.fitnessLevel).toBe('intermediate');

      // Verify data persistence by fetching again
      const fetchedUser = await userService.getUser(createdUser.id);
      expect(fetchedUser!.age).toBe(30);
      expect(fetchedUser!.height).toBe(180);
    });

    it('should return null when updating non-existent user', async() => {
      // Arrange: Use non-existent user ID
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      // Act
      const result = await userService.updateProfileData(nonExistentId, { age: 25 });

      // Assert
      expect(result).toBeNull();
    });

    it('should handle empty profile data updates', async() => {
      // Arrange: Create real user with initial profile data
      const userData = createTestUserData({
        username: 'empty_update_test',
      });

      const createdUser = await repository.create(userData);

      // Set initial profile data
      await userService.updateProfileData(createdUser.id, {
        age: 25,
        gender: 'male',
        height: 170,
        weight: 70,
      });

      // Act: Update with empty data (should not change anything)
      const result = await userService.updateProfileData(createdUser.id, {});

      // Assert: User should still exist and be unchanged
      expect(result).toBeTruthy();
      expect(result!.id).toBe(createdUser.id);
      expect(result!.age).toBe(25); // Original age should remain
      expect(result!.gender).toBe('male'); // Original gender should remain
      expect(result!.height).toBe(170); // Original height should remain
      expect(result!.weight).toBe(70); // Original weight should remain
    });

    it('should handle partial profile updates correctly', async() => {
      // Arrange: Create user with basic data
      const userData = createTestUserData({
        username: 'partial_update_test',
      });

      const createdUser = await repository.create(userData);

      // Set initial profile data
      await userService.updateProfileData(createdUser.id, {
        age: 25,
        gender: 'male',
        height: 170,
        weight: 70,
      });

      // Act: Update only height
      const partialUpdate = { height: 175 };
      const updatedUser = await userService.updateProfileData(createdUser.id, partialUpdate);

      // Assert: Only height changed, other fields remain
      expect(updatedUser!.height).toBe(175);
      expect(updatedUser!.age).toBe(25); // Unchanged
      expect(updatedUser!.gender).toBe('male'); // Unchanged
      expect(updatedUser!.weight).toBe(70); // Unchanged
    });
  });

  describe('getUser - real database operations', () => {
    it('should retrieve user from real database', async() => {
      // Arrange: Create real user
      const userData = createTestUserData({
        username: 'get_user_test',
        firstName: 'John',
        lastName: 'Doe',
      });

      const createdUser = await repository.create(userData);

      // Set initial profile data
      await userService.updateProfileData(createdUser.id, {
        age: 28,
        gender: 'male',
        height: 175,
      });

      // Act
      const retrievedUser = await userService.getUser(createdUser.id);

      // Assert
      expect(retrievedUser).toBeTruthy();
      expect(retrievedUser!.id).toBe(createdUser.id);
      expect(retrievedUser!.username).toBe('get_user_test');
      expect(retrievedUser!.firstName).toBe('John');
      expect(retrievedUser!.lastName).toBe('Doe');
      expect(retrievedUser!.age).toBe(28);
      expect(retrievedUser!.gender).toBe('male');
      expect(retrievedUser!.height).toBe(175);
    });

    it('should return null when user does not exist', async() => {
      // Arrange: Use non-existent ID
      const nonExistentId = '99999999-9999-9999-9999-999999999999';

      // Act
      const result = await userService.getUser(nonExistentId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('upsertUser - real database operations', () => {
    it('should return existing user if found by provider', async() => {
      // Arrange: Create user first using upsertUser
      const userData = {
        provider: 'telegram' as const,
        providerUserId: 'upsert_existing_123',
        username: 'upsert_existing_test',
      };

      const createdUser = await userService.upsertUser(userData);

      // Act: Try to upsert same provider/providerUserId
      const upsertData = {
        provider: 'telegram' as const,
        providerUserId: 'upsert_existing_123',
      };

      const result = await userService.upsertUser(upsertData);

      // Assert: Should return existing user, not create new
      expect(result).toBeTruthy();
      expect(result.id).toBe(createdUser.id); // Same user ID
      expect(result.username).toBe('upsert_existing_test');
    });

    it('should create new user if not found by provider', async() => {
      // Arrange: Use unique provider data
      const upsertData = {
        provider: 'telegram' as const,
        providerUserId: `upsert_new_${Date.now()}_${Math.random()}`,
        username: `new_upsert_test_${Date.now()}`,
      };

      // Act
      const result = await userService.upsertUser(upsertData);

      // Assert: Should create and return new user
      expect(result).toBeTruthy();
      expect(result.username).toBe(upsertData.username);

      // Verify it was actually saved to database
      const fetchedUser = await userService.getUser(result.id);
      expect(fetchedUser).toBeTruthy();
      expect(fetchedUser!.username).toBe(upsertData.username);
    });

    it('should handle multiple providers correctly', async() => {
      // Arrange: Create users with different providers
      const telegramUser = createTestUserData({
        provider: 'telegram',
        providerUserId: `telegram_${Date.now()}`,
        username: 'telegram_provider_test',
      });

      const discordUser = createTestUserData({
        provider: 'discord',
        providerUserId: `discord_${Date.now()}`,
        username: 'discord_provider_test',
      });

      await repository.create(telegramUser);
      await repository.create(discordUser);

      // Act: Upsert should find correct user by provider
      const telegramResult = await userService.upsertUser({
        provider: 'telegram' as const,
        providerUserId: telegramUser.providerUserId,
      });

      const discordResult = await userService.upsertUser({
        provider: 'discord' as const,
        providerUserId: discordUser.providerUserId,
      });

      // Assert: Should return correct users for each provider
      expect(telegramResult.username).toBe('telegram_provider_test');
      expect(discordResult.username).toBe('discord_provider_test');
    });
  });

  describe('service-repository integration', () => {
    it('should handle complex workflow: create -> update -> retrieve', async() => {
      // Arrange: Create user
      const userData = createTestUserData({
        username: 'workflow_test',
      });

      const createdUser = await repository.create(userData);
      expect(createdUser.profileStatus).toBe('incomplete');

      // Act: Update profile through service
      const updatedUser = await userService.updateProfileData(createdUser.id, {
        age: 30,
        gender: 'female' as const,
        profileStatus: 'complete' as const,
      });

      // Assert: Changes persisted
      expect(updatedUser!.age).toBe(30);
      expect(updatedUser!.gender).toBe('female');
      expect(updatedUser!.profileStatus).toBe('complete');

      // Verify by fetching fresh data
      const freshUser = await userService.getUser(createdUser.id);
      expect(freshUser!.age).toBe(30);
      expect(freshUser!.gender).toBe('female');
      expect(freshUser!.profileStatus).toBe('complete');
    });

    it('should handle concurrent operations correctly', async() => {
      // Arrange: Create user
      const userData = createTestUserData({
        username: 'concurrent_test',
      });

      const createdUser = await repository.create(userData);

      // Act: Perform multiple updates (simulating concurrent access)
      const update1 = userService.updateProfileData(createdUser.id, { age: 26 });
      const update2 = userService.updateProfileData(createdUser.id, { height: 170 });

      const [result1, result2] = await Promise.all([update1, update2]);

      // Assert: Both operations should succeed
      expect(result1).toBeTruthy();
      expect(result2).toBeTruthy();

      // Final state should reflect both updates
      const finalUser = await userService.getUser(createdUser.id);
      expect(finalUser!.age).toBe(26);
      expect(finalUser!.height).toBe(170);
    });
  });
});
