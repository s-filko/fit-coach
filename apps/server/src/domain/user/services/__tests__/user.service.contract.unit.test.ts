import { IUserService } from '@domain/user/ports';

import { User, UserService } from '../user.service';

// Repository interface for mocking
interface UserRepository {
  updateProfileData: jest.MockedFunction<(id: string, data: Partial<User>) => Promise<User | null>>;
  getById: jest.MockedFunction<(id: string) => Promise<User | null>>;
  create: jest.MockedFunction<(input: any) => Promise<User>>;
  findByProvider: jest.MockedFunction<(provider: string, providerUserId: string) => Promise<User | null>>;
}

// Mock the repository with proper typing
const mockRepository: jest.Mocked<UserRepository> = {
  updateProfileData: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  findByProvider: jest.fn(),
};

/**
 * IUserService Contract Unit Tests
 *
 * These tests complement integration tests by providing fast feedback.
 * They test the same functionality as integration tests but with mocks.
 *
 * According to TESTING.md: "Repository interaction belongs to integration tests"
 * But these unit tests provide:
 * - Fast feedback during development
 * - Isolation from database issues
 * - Contract validation between service and repository
 *
 * Integration tests (user.service.integration.test.ts) test the same logic
 * with real database to ensure end-to-end functionality.
 */
describe('IUserService – contract unit tests (with mocks)', () => {
  let userService: IUserService;

  beforeEach(() => {
    jest.clearAllMocks();
    userService = new UserService(mockRepository as any);
  });

  describe('updateProfileData', () => {
    it('should call repository updateProfileData with correct parameters and return result', async() => {
      // Arrange
      const userId = 'test-user-123';
      const profileData = { age: 25, gender: 'male' as const };
      const expectedResult = { id: userId, age: 25, gender: 'male' as const };

      mockRepository.updateProfileData.mockResolvedValue(expectedResult as any);

      // Act
      const result = await userService.updateProfileData(userId, profileData);

      // Assert
      expect(mockRepository.updateProfileData).toHaveBeenCalledWith(userId, profileData);
      expect(result).toEqual(expectedResult);
    });

    it('should return null when repository returns null', async() => {
      // Arrange
      const userId = 'non-existent-user';
      const profileData = { age: 25 };

      mockRepository.updateProfileData.mockResolvedValue(null);

      // Act
      const result = await userService.updateProfileData(userId, profileData);

      // Assert
      expect(mockRepository.updateProfileData).toHaveBeenCalledWith(userId, profileData);
      expect(result).toBeNull();
    });

    it('should handle empty profile data', async() => {
      // Arrange
      const userId = 'test-user-123';
      const profileData = {};

      mockRepository.updateProfileData.mockResolvedValue({ id: userId } as any);

      // Act
      const result = await userService.updateProfileData(userId, profileData);

      // Assert
      expect(mockRepository.updateProfileData).toHaveBeenCalledWith(userId, profileData);
      expect(result).toBeTruthy();
    });

    it('should handle partial updates correctly', async() => {
      // Arrange
      const userId = 'test-user-123';
      const profileData = { height: 175 };
      const expectedResult = { id: userId, height: 175, age: 25 };

      mockRepository.updateProfileData.mockResolvedValue(expectedResult as any);

      // Act
      const result = await userService.updateProfileData(userId, profileData);

      // Assert
      expect(mockRepository.updateProfileData).toHaveBeenCalledWith(userId, profileData);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getUser', () => {
    it('should call repository getById with correct id and return result', async() => {
      // Arrange
      const userId = 'test-user-123';
      const expectedUser = { id: userId, username: 'testuser' };

      mockRepository.getById.mockResolvedValue(expectedUser as any);

      // Act
      const result = await userService.getUser(userId);

      // Assert
      expect(mockRepository.getById).toHaveBeenCalledWith(userId);
      expect(result).toEqual(expectedUser);
    });

    it('should return null when user not found', async() => {
      // Arrange
      const userId = 'non-existent-user';

      mockRepository.getById.mockResolvedValue(null);

      // Act
      const result = await userService.getUser(userId);

      // Assert
      expect(mockRepository.getById).toHaveBeenCalledWith(userId);
      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle repository errors in updateProfileData', async() => {
      // Arrange
      const userId = 'test-user-123';
      const profileData = { age: 25 };
      const error = new Error('Database connection failed');

      mockRepository.updateProfileData.mockRejectedValue(error);

      // Act & Assert
      await expect(userService.updateProfileData(userId, profileData))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle repository errors in getUser', async() => {
      // Arrange
      const userId = 'test-user-123';
      const error = new Error('Database connection failed');

      mockRepository.getById.mockRejectedValue(error);

      // Act & Assert
      await expect(userService.getUser(userId))
        .rejects.toThrow('Database connection failed');
    });
  });

  describe('upsertUser', () => {
    it('should return existing user if found by provider', async() => {
      // Arrange
      const provider = 'telegram';
      const providerUserId = 'user123';
      const existingUser = { id: 'existing-user-id', username: 'existing' };

      mockRepository.findByProvider.mockResolvedValue(existingUser as any);

      // Act
      const result = await userService.upsertUser({ provider, providerUserId });

      // Assert
      expect(mockRepository.findByProvider).toHaveBeenCalledWith(provider, providerUserId);
      expect(mockRepository.create).not.toHaveBeenCalled();
      expect(result).toEqual(existingUser);
    });

    it('should create new user if not found by provider', async() => {
      // Arrange
      const provider = 'telegram';
      const providerUserId = 'newuser123';
      const newUser = { id: 'new-user-id', username: 'newuser' };

      mockRepository.findByProvider.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue(newUser as any);

      // Act
      const result = await userService.upsertUser({ provider, providerUserId });

      // Assert
      expect(mockRepository.findByProvider).toHaveBeenCalledWith(provider, providerUserId);
      expect(mockRepository.create).toHaveBeenCalledWith({ provider, providerUserId });
      expect(result).toEqual(newUser);
    });

    it('should handle create failure after find', async() => {
      // Arrange
      const provider = 'telegram';
      const providerUserId = 'newuser123';
      const error = new Error('Failed to create user');

      mockRepository.findByProvider.mockResolvedValue(null);
      mockRepository.create.mockRejectedValue(error);

      // Act & Assert
      await expect(userService.upsertUser({ provider, providerUserId }))
        .rejects.toThrow('Failed to create user');
    });
  });
});
