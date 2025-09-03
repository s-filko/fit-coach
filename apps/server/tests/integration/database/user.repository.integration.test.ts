import { DrizzleUserRepository } from '../../../src/infra/db/repositories/user.repository';

describe('DrizzleUserRepository - Integration Test', () => {
  let repository: DrizzleUserRepository;

  beforeEach(() => {
    repository = new DrizzleUserRepository();
  });

  describe('create', () => {
    it('should create user with correct data structure', async () => {
      const userData = {
        provider: 'telegram',
        providerUserId: `test_${Date.now()}`, // Unique ID to avoid conflicts
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        languageCode: 'en'
      };

      const result = await repository.create(userData);

      expect(result).toHaveProperty('id');
      expect(result.username).toBe('testuser');
      expect(result.firstName).toBe('Test');
      expect(result.lastName).toBe('User');
      expect(result.languageCode).toBe('en');
      expect(result.profileStatus).toBe('incomplete');

      // Verify user exists in database
      const retrievedUser = await repository.getById(result.id);
      expect(retrievedUser).toBeTruthy();
      expect(retrievedUser!.username).toBe('testuser');
    });
  });

  describe('updateProfileData', () => {
    it('should update user profile data correctly', async () => {
      // First create a test user
      const createData = {
        provider: 'telegram',
        providerUserId: `test_update_${Date.now()}`,
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        languageCode: 'en'
      };

      const user = await repository.create(createData);
      const profileData = {
        age: 28,
        gender: 'male' as const,
        height: 175,
        weight: 75,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight'
      };

      const result = await repository.updateProfileData(user.id, profileData);

      expect(result).toBeTruthy();
      expect(result!.age).toBe(28);
      expect(result!.gender).toBe('male');
      expect(result!.height).toBe(175);
      expect(result!.weight).toBe(75);
      expect(result!.fitnessLevel).toBe('intermediate');
      expect(result!.fitnessGoal).toBe('lose weight');
    });
  });
});