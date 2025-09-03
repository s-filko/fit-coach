import { UserService, User } from '../../../src/domain/user/services/user.service';

// Repository interface for mocking
interface UserRepository {
  updateProfileData: (id: string, data: Partial<User>) => Promise<User | null>;
  getById: (id: string) => Promise<User | null>;
  create: (input: any) => Promise<User>;
  findByProvider: (provider: string, providerUserId: string) => Promise<User | null>;
}

// Mock the repository with proper typing
const mockRepository: jest.Mocked<UserRepository> = {
  updateProfileData: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  findByProvider: jest.fn(),
};

// Test data factory to reduce duplication
const createTestUser = (overrides: Partial<User> = {}): User => ({
  id: 'test-user-123',
  profileStatus: 'incomplete' as const,
  ...overrides
});

/**
 * UserService Test Suite
 *
 * Contains both unit and integration tests for UserService:
 * - Business Logic Tests: Pure unit tests without external dependencies
 * - Repository Interaction Tests: Tests with mocked repository interactions
 */

// Dummy repository for pure business logic tests (never called)
const dummyRepository: jest.Mocked<UserRepository> = {
  updateProfileData: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  findByProvider: jest.fn(),
};
describe('UserService', () => {
  let userService: UserService;

  describe('Repository Interaction Tests', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      userService = new UserService(mockRepository);
    });
    describe('updateProfileData', () => {
      it('should call repository with correct parameters and return result', async () => {
        const userId = 'test-user-123';
        const profileData = { age: 28, gender: 'male' as const };
        const expectedUser = createTestUser(profileData);

        mockRepository.updateProfileData.mockResolvedValue(expectedUser);

        const result = await userService.updateProfileData(userId, profileData);

        expect(mockRepository.updateProfileData).toHaveBeenCalledWith(userId, profileData);
        expect(result).toEqual(expectedUser);
      });

      it('should return null when user not found', async () => {
        mockRepository.updateProfileData.mockResolvedValue(null);

        const result = await userService.updateProfileData('non-existent', { age: 25 });

        expect(result).toBeNull();
      });

      it('should handle empty profile data', async () => {
        const userId = 'test-user-123';
        const expectedUser = createTestUser();

        mockRepository.updateProfileData.mockResolvedValue(expectedUser);

        const result = await userService.updateProfileData(userId, {});

        expect(mockRepository.updateProfileData).toHaveBeenCalledWith(userId, {});
        expect(result).toEqual(expectedUser);
      });

      it('should handle partial updates correctly', async () => {
        const userId = 'test-user-123';
        const partialData = { age: 30 };
        const expectedUser = createTestUser({ age: 30 });

        mockRepository.updateProfileData.mockResolvedValue(expectedUser);

        const result = await userService.updateProfileData(userId, partialData);

        expect(mockRepository.updateProfileData).toHaveBeenCalledWith(userId, partialData);
        expect(result!.age).toBe(30);
      });
    });

    describe('getUser', () => {
      it('should call repository getById with correct id', async () => {
        const userId = 'test-user-123';
        const expectedUser = createTestUser();

        mockRepository.getById.mockResolvedValue(expectedUser);

        const result = await userService.getUser(userId);

        expect(mockRepository.getById).toHaveBeenCalledWith(userId);
        expect(result).toEqual(expectedUser);
      });

      it('should return null when user not found', async () => {
        mockRepository.getById.mockResolvedValue(null);

        const result = await userService.getUser('non-existent');

        expect(result).toBeNull();
      });
    });

    describe('Error handling', () => {
      it('should handle repository errors in updateProfileData', async () => {
        mockRepository.updateProfileData.mockRejectedValue(new Error('Database error'));

        await expect(userService.updateProfileData('user-123', { age: 25 }))
          .rejects
          .toThrow('Database error');
      });

      it('should handle repository errors in getUser', async () => {
        mockRepository.getById.mockRejectedValue(new Error('User not found'));

        await expect(userService.getUser('non-existent'))
          .rejects
          .toThrow('User not found');
      });

      it('should handle repository errors in upsertUser', async () => {
        mockRepository.findByProvider.mockRejectedValue(new Error('DB connection failed'));

        const input = { provider: 'telegram', providerUserId: '123' };

        await expect(userService.upsertUser(input))
          .rejects
          .toThrow('DB connection failed');
      });
    });

    describe('upsertUser', () => {
      it('should return existing user if found', async () => {
        const input = {
          provider: 'telegram',
          providerUserId: '12345'
        };
        const existingUser = createTestUser();

        mockRepository.findByProvider.mockResolvedValue(existingUser);

        const result = await userService.upsertUser(input);

        expect(mockRepository.findByProvider).toHaveBeenCalledWith(input.provider, input.providerUserId);
        expect(result).toEqual(existingUser);
        expect(mockRepository.create).not.toHaveBeenCalled();
      });

      it('should create new user if not found', async () => {
        const input = {
          provider: 'telegram',
          providerUserId: '12345'
        };
        const newUser = createTestUser();

        mockRepository.findByProvider.mockResolvedValue(null);
        mockRepository.create.mockResolvedValue(newUser);

        const result = await userService.upsertUser(input);

        expect(mockRepository.findByProvider).toHaveBeenCalledWith(input.provider, input.providerUserId);
        expect(mockRepository.create).toHaveBeenCalledWith(input);
        expect(result).toEqual(newUser);
      });

      it('should handle create failure after find', async () => {
        const input = { provider: 'telegram', providerUserId: '123' };
        const expectedUser = createTestUser();

        mockRepository.findByProvider.mockResolvedValue(null);
        mockRepository.create.mockRejectedValue(new Error('Create failed'));

        await expect(userService.upsertUser(input))
          .rejects
          .toThrow('Create failed');
      });
    });
  });
});
