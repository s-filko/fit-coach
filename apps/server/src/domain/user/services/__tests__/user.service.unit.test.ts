import { UserService, User } from '../user.service';

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

  describe('Business Logic - Pure Unit Tests (No External Dependencies)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Use dummy repository - never called in pure business logic tests
      userService = new UserService(dummyRepository);
    });
    describe('isRegistrationComplete', () => {
      it('should return true only for "complete" status', () => {
        expect(userService.isRegistrationComplete(createTestUser({ profileStatus: 'complete' }))).toBe(true);
        expect(userService.isRegistrationComplete(createTestUser({ profileStatus: 'incomplete' }))).toBe(false);
        expect(userService.isRegistrationComplete(createTestUser({ profileStatus: 'collecting_basic' }))).toBe(false);
        expect(userService.isRegistrationComplete(createTestUser({ profileStatus: 'collecting_level' }))).toBe(false);
        expect(userService.isRegistrationComplete(createTestUser({ profileStatus: 'collecting_goals' }))).toBe(false);
        expect(userService.isRegistrationComplete(createTestUser({ profileStatus: 'confirmation' }))).toBe(false);
      });

      it('should return false for undefined, null, or invalid status', () => {
        expect(userService.isRegistrationComplete(createTestUser({ profileStatus: undefined }))).toBe(false);
        expect(userService.isRegistrationComplete(createTestUser({ profileStatus: null as any }))).toBe(false);
        expect(userService.isRegistrationComplete(createTestUser({ profileStatus: 'invalid' as any }))).toBe(false);
      });
    });

    describe('needsRegistration', () => {
      it('should return false for complete registration', () => {
        expect(userService.needsRegistration(createTestUser({ profileStatus: 'complete' }))).toBe(false);
      });

      it('should return true for any incomplete status', () => {
        expect(userService.needsRegistration(createTestUser({ profileStatus: 'incomplete' }))).toBe(true);
        expect(userService.needsRegistration(createTestUser({ profileStatus: 'collecting_basic' }))).toBe(true);
        expect(userService.needsRegistration(createTestUser({ profileStatus: 'collecting_level' }))).toBe(true);
        expect(userService.needsRegistration(createTestUser({ profileStatus: 'collecting_goals' }))).toBe(true);
        expect(userService.needsRegistration(createTestUser({ profileStatus: 'confirmation' }))).toBe(true);
      });

      it('should return true for undefined status', () => {
        expect(userService.needsRegistration(createTestUser({ profileStatus: undefined }))).toBe(true);
      });
    });

    describe('getCurrentRegistrationStep', () => {
      it('should return correct step for each status', () => {
        const testCases = [
          { status: 'incomplete', expected: 'incomplete' },
          { status: 'collecting_basic', expected: 'collecting_basic' },
          { status: 'collecting_level', expected: 'collecting_level' },
          { status: 'collecting_goals', expected: 'collecting_goals' },
          { status: 'confirmation', expected: 'confirmation' },
          { status: 'complete', expected: 'complete' },
        ];

        testCases.forEach(({ status, expected }) => {
          expect(userService.getCurrentRegistrationStep(createTestUser({ profileStatus: status })))
            .toBe(expected);
        });
      });
    });

    describe('getNextRegistrationStep', () => {
      it('should return correct next step in sequence', () => {
        const testCases = [
          { current: 'incomplete', next: 'collecting_basic' },
          { current: 'collecting_basic', next: 'collecting_level' },
          { current: 'collecting_level', next: 'collecting_goals' },
          { current: 'collecting_goals', next: 'confirmation' },
          { current: 'confirmation', next: 'complete' },
          { current: 'complete', next: 'complete' },
        ];

        testCases.forEach(({ current, next }) => {
          expect(userService.getNextRegistrationStep(createTestUser({ profileStatus: current })))
            .toBe(next);
        });
      });
    });
  });
});
