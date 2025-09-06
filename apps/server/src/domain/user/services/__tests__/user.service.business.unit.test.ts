import { IUserService } from '@domain/user/ports';

import { createTestUser } from '../../../../../tests/shared/test-factories';
import { UserService } from '../user.service';

/**
 * IUserService Business Logic Unit Tests
 * Tests pure business logic without external dependencies
 */
describe('IUserService – business logic unit', () => {
  let userService: IUserService;

  // Create a dummy service for pure business logic tests
  // This service never calls external dependencies
  beforeAll(() => {
    // For pure business logic tests, we don't need a real service instance
    // We can test static methods or create minimal instances
    userService = {} as any; // We'll test methods directly
  });

  describe('isRegistrationComplete', () => {
    it('should return true only for "complete" status', () => {
      // Arrange
      const completeUser = createTestUser({ profileStatus: 'complete' });
      const incompleteUser = createTestUser({ profileStatus: 'incomplete' });
      const collectingBasicUser = createTestUser({ profileStatus: 'collecting_basic' });
      const collectingLevelUser = createTestUser({ profileStatus: 'collecting_level' });
      const collectingGoalsUser = createTestUser({ profileStatus: 'collecting_goals' });
      const confirmationUser = createTestUser({ profileStatus: 'confirmation' });

      // Act & Assert
      expect(UserService.prototype.isRegistrationComplete(completeUser)).toBe(true);
      expect(UserService.prototype.isRegistrationComplete(incompleteUser)).toBe(false);
      expect(UserService.prototype.isRegistrationComplete(collectingBasicUser)).toBe(false);
      expect(UserService.prototype.isRegistrationComplete(collectingLevelUser)).toBe(false);
      expect(UserService.prototype.isRegistrationComplete(collectingGoalsUser)).toBe(false);
      expect(UserService.prototype.isRegistrationComplete(confirmationUser)).toBe(false);
    });

    it('should return false for undefined, null, or invalid status', () => {
      // Arrange
      const undefinedStatusUser = createTestUser({ profileStatus: undefined });
      const nullStatusUser = createTestUser({ profileStatus: null as any });
      const invalidStatusUser = createTestUser({ profileStatus: 'invalid' as any });

      // Act & Assert
      expect(UserService.prototype.isRegistrationComplete(undefinedStatusUser)).toBe(false);
      expect(UserService.prototype.isRegistrationComplete(nullStatusUser)).toBe(false);
      expect(UserService.prototype.isRegistrationComplete(invalidStatusUser)).toBe(false);
    });
  });

  describe('needsRegistration', () => {
    it('should return false for complete registration', () => {
      // Arrange
      const completeUser = createTestUser({ profileStatus: 'complete' });

      // Act & Assert
      expect(UserService.prototype.needsRegistration(completeUser)).toBe(false);
    });

    it('should return true for any incomplete status', () => {
      // Arrange
      const incompleteUser = createTestUser({ profileStatus: 'incomplete' });
      const collectingBasicUser = createTestUser({ profileStatus: 'collecting_basic' });
      const collectingLevelUser = createTestUser({ profileStatus: 'collecting_level' });
      const collectingGoalsUser = createTestUser({ profileStatus: 'collecting_goals' });
      const confirmationUser = createTestUser({ profileStatus: 'confirmation' });

      // Act & Assert
      expect(UserService.prototype.needsRegistration(incompleteUser)).toBe(true);
      expect(UserService.prototype.needsRegistration(collectingBasicUser)).toBe(true);
      expect(UserService.prototype.needsRegistration(collectingLevelUser)).toBe(true);
      expect(UserService.prototype.needsRegistration(collectingGoalsUser)).toBe(true);
      expect(UserService.prototype.needsRegistration(confirmationUser)).toBe(true);
    });

    it('should return true for undefined status', () => {
      // Arrange
      const undefinedStatusUser = createTestUser({ profileStatus: undefined });

      // Act & Assert
      expect(UserService.prototype.needsRegistration(undefinedStatusUser)).toBe(true);
    });
  });

  describe('getCurrentRegistrationStep', () => {
    it('should return correct step for each status', () => {
      // Arrange
      const testCases = [
        { status: 'incomplete', expected: 'incomplete' },
        { status: 'collecting_basic', expected: 'collecting_basic' },
        { status: 'collecting_level', expected: 'collecting_level' },
        { status: 'collecting_goals', expected: 'collecting_goals' },
        { status: 'confirmation', expected: 'confirmation' },
        { status: 'complete', expected: 'complete' },
      ] as const;

      testCases.forEach(({ status, expected }) => {
        // Act
        const result = UserService.prototype.getCurrentRegistrationStep(createTestUser({ profileStatus: status }));

        // Assert
        expect(result).toBe(expected);
      });
    });
  });

  describe('getNextRegistrationStep', () => {
    it('should return correct next step in sequence', () => {
      // Arrange
      const testCases = [
        { current: 'incomplete', next: 'collecting_basic' },
        { current: 'collecting_basic', next: 'collecting_level' },
        { current: 'collecting_level', next: 'collecting_goals' },
        { current: 'collecting_goals', next: 'confirmation' },
        { current: 'confirmation', next: 'complete' },
        { current: 'complete', next: 'complete' },
      ] as const;

      testCases.forEach(({ current, next }) => {
        // Act
        const result = UserService.prototype.getNextRegistrationStep(createTestUser({ profileStatus: current }));

        // Assert
        expect(result).toBe(next);
      });
    });
  });
});
