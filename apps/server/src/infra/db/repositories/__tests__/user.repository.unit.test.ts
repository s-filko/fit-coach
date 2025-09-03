import { DrizzleUserRepository } from '../user.repository';

// Mock the database completely
const mockDb = {
  insert: jest.fn(),
  select: jest.fn(),
  update: jest.fn(),
  from: jest.fn(),
  where: jest.fn(),
  values: jest.fn(),
  returning: jest.fn(),
  eq: jest.fn(),
  limit: jest.fn(),
};

// Mock the drizzle module
jest.mock('@infra/db/drizzle', () => ({
  db: mockDb
}));

// Mock the schema
jest.mock('@infra/db/schema', () => ({
  users: 'users_table_mock',
  userAccounts: 'user_accounts_table_mock'
}));

describe('DrizzleUserRepository - Unit Tests', () => {
  let repository: DrizzleUserRepository;

  beforeEach(() => {
    repository = new DrizzleUserRepository();
    jest.clearAllMocks();

    // Setup default mock chains for successful operations
    mockDb.insert
      .mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 'test-user-uuid' }])
        })
      })
      .mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined)
      });

    mockDb.update.mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{
            id: 'test-user-uuid',
            age: 25,
            gender: 'female',
            height: 165,
            weight: 60,
            fitnessLevel: 'intermediate',
            fitnessGoal: 'lose weight',
            profileStatus: 'complete',
            firstName: null,
            lastName: null,
            username: null,
            languageCode: null,
            updatedAt: new Date()
          }])
        })
      })
    });

    mockDb.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{
            id: 'test-user-uuid',
            age: 25,
            gender: 'female',
            height: 165,
            weight: 60,
            fitnessLevel: 'intermediate',
            fitnessGoal: 'lose weight',
            profileStatus: 'complete',
            firstName: null,
            lastName: null,
            username: null,
            languageCode: null
          }])
        })
      })
    });
  });

  describe('updateProfileData - Unit Test', () => {
    it('should call database update with correct parameters', async () => {
      const userId = 'test-user-123';
      const profileData = {
        age: 30,
        gender: 'male' as const,
        height: 180,
        weight: 80,
        fitnessLevel: 'advanced' as const,
        fitnessGoal: 'build muscle',
        profileStatus: 'complete'
      };

      const result = await repository.updateProfileData(userId, profileData);

      // Verify that update was called
      expect(mockDb.update).toHaveBeenCalled();

      // Verify the update data structure
      const updateCall = mockDb.update.mock.results[0].value;
      expect(updateCall.set).toHaveBeenCalledWith({
        updatedAt: expect.any(Date),
        profileStatus: 'complete',
        fitnessLevel: 'advanced',
        age: 30,
        gender: 'male',
        height: 180,
        weight: 80,
        fitnessGoal: 'build muscle'
      });

      expect(result).toBeDefined();
      expect(result!.age).toBe(25); // From mock data
    });

    it('should handle partial updates correctly', async () => {
      const userId = 'test-user-123';
      const partialData = {
        age: 35,
        fitnessGoal: 'maintain fitness'
      };

      const result = await repository.updateProfileData(userId, partialData);

      const updateCall = mockDb.update.mock.results[0].value;
      expect(updateCall.set).toHaveBeenCalledWith({
        updatedAt: expect.any(Date),
        age: 35,
        fitnessGoal: 'maintain fitness'
        // Other fields should not be included
      });

      expect(result).toBeDefined();
    });

    it('should return null when database returns empty result', async () => {
      // Mock empty result
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([])
          })
        })
      });

      const result = await repository.updateProfileData('non-existent', { age: 25 });

      expect(result).toBeNull();
    });

    it('should include updatedAt in all updates', async () => {
      const userId = 'test-user-123';
      const profileData = { fitnessLevel: 'beginner' as const };

      await repository.updateProfileData(userId, profileData);

      const updateCall = mockDb.update.mock.results[0].value;
      const setCall = updateCall.set.mock.calls[0][0];

      expect(setCall.updatedAt).toBeInstanceOf(Date);
    });

    it('should handle null values for clearing fields', async () => {
      const userId = 'test-user-123';
      const clearData = {
        age: null,  // Clear age
        gender: null,  // Clear gender
        height: 175  // Update height
      };

      const result = await repository.updateProfileData(userId, clearData);

      const updateCall = mockDb.update.mock.results[0].value;
      expect(updateCall.set).toHaveBeenCalledWith({
        updatedAt: expect.any(Date),
        age: null,
        gender: null,
        height: 175
      });
    });

    it('should skip update when no profile fields provided', async () => {
      const userId = 'test-user-123';
      const emptyData = {}; // No fields to update

      const result = await repository.updateProfileData(userId, emptyData);

      // Should not call database update, just return user
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result!.id).toBe('test-user-uuid');
    });

    it('should update single field in complete profile', async () => {
      const userId = 'test-user-123';
      const singleFieldUpdate = {
        age: 30  // Update only age, leave other fields unchanged
      };

      const result = await repository.updateProfileData(userId, singleFieldUpdate);

      const updateCall = mockDb.update.mock.results[0].value;
      expect(updateCall.set).toHaveBeenCalledWith({
        updatedAt: expect.any(Date),
        age: 30
        // Only age should be updated, other fields remain unchanged
      });

      expect(result).toBeDefined();
      expect(result!.age).toBe(25); // From mock data
      expect(result!.gender).toBe('female'); // Unchanged
      expect(result!.height).toBe(165); // Unchanged
    });

    it('should update multiple fields selectively', async () => {
      const userId = 'test-user-123';
      const selectiveUpdate = {
        age: 40,
        fitnessGoal: 'build muscle',
        // gender and height are NOT included, so they won't be updated
      };

      const result = await repository.updateProfileData(userId, selectiveUpdate);

      const updateCall = mockDb.update.mock.results[0].value;
      expect(updateCall.set).toHaveBeenCalledWith({
        updatedAt: expect.any(Date),
        age: 40,
        fitnessGoal: 'build muscle'
        // Only specified fields are updated
      });

      expect(result).toBeDefined();
    });
  });

  describe('create - Unit Test', () => {
    it('should create user with minimal required data', async () => {
      const userData = {
        provider: 'telegram',
        providerUserId: 'tg123',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User'
      };

      const result = await repository.create(userData);

      expect(mockDb.insert).toHaveBeenCalledTimes(2); // users and userAccounts

      // Check users table insert - get the values call
      expect(mockDb.insert).toHaveBeenCalledWith('users_table_mock');
      const usersInsertMock = mockDb.insert.mock.results[0].value;
      expect(usersInsertMock.values).toHaveBeenCalledWith({
        name: null,
        email: null,
        gender: null,
        height: null,
        heightUnit: null,
        weight: null,
        weightUnit: null,
        birthYear: null,
        age: null,
        fitnessGoal: null,
        tone: null,
        reminderEnabled: false,
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        languageCode: null,
        profileStatus: 'incomplete',
        fitnessLevel: null
      });

      expect(result.id).toBe('test-user-uuid');
    });

    it('should handle undefined optional fields', async () => {
      const userData = {
        provider: 'telegram',
        providerUserId: 'tg123'
        // No optional fields
      };

      const result = await repository.create(userData);

      const usersInsertMock = mockDb.insert.mock.results[0].value;
      expect(usersInsertMock.values).toHaveBeenCalledWith({
        name: null,
        email: null,
        gender: null,
        height: null,
        heightUnit: null,
        weight: null,
        weightUnit: null,
        birthYear: null,
        age: null,
        fitnessGoal: null,
        tone: null,
        reminderEnabled: false,
        username: null,
        firstName: null,
        lastName: null,
        languageCode: null,
        profileStatus: 'incomplete',
        fitnessLevel: null
      });
    });
  });

  describe('getById - Unit Test', () => {
    it('should return user data correctly formatted', async () => {
      const userId = 'test-user-123';

      const result = await repository.getById(userId);

      expect(mockDb.select).toHaveBeenCalled();
      expect(result).toEqual({
        id: 'test-user-uuid',
        age: 25,
        gender: 'female',
        height: 165,
        weight: 60,
        fitnessLevel: 'intermediate',
        fitnessGoal: 'lose weight',
        profileStatus: 'complete',
        firstName: null,
        lastName: null,
        username: null,
        languageCode: null
      });
    });

    it('should return null when user not found', async () => {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([])
          })
        })
      });

      const result = await repository.getById('non-existent');

      expect(result).toBeNull();
    });
  });
});
