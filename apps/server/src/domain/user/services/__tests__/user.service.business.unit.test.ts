import { createTestUser } from '../../../../../tests/shared/test-factories';
import { UserService } from '../user.service';

/**
 * IUserService Business Logic Unit Tests
 * Tests pure business logic without external dependencies
 */
describe('IUserService – business logic unit', () => {
  describe('isRegistrationComplete', () => {
    it('should return true only for "complete" status', () => {
      const completeUser = createTestUser({ profileStatus: 'complete' });
      const registrationUser = createTestUser({ profileStatus: 'registration' });
      const incompleteUser = createTestUser({ profileStatus: 'incomplete' });

      expect(UserService.prototype.isRegistrationComplete(completeUser)).toBe(true);
      expect(UserService.prototype.isRegistrationComplete(registrationUser)).toBe(false);
      expect(UserService.prototype.isRegistrationComplete(incompleteUser)).toBe(false);
    });

    it('should return false for undefined, null, or invalid status', () => {
      const undefinedStatusUser = createTestUser({ profileStatus: undefined });
      const nullStatusUser = createTestUser({ profileStatus: null as any });
      const invalidStatusUser = createTestUser({ profileStatus: 'invalid' as any });

      expect(UserService.prototype.isRegistrationComplete(undefinedStatusUser)).toBe(false);
      expect(UserService.prototype.isRegistrationComplete(nullStatusUser)).toBe(false);
      expect(UserService.prototype.isRegistrationComplete(invalidStatusUser)).toBe(false);
    });
  });

  describe('needsRegistration', () => {
    it('should return false for complete registration', () => {
      const completeUser = createTestUser({ profileStatus: 'complete' });
      expect(UserService.prototype.needsRegistration(completeUser)).toBe(false);
    });

    it('should return true for any non-complete status', () => {
      const registrationUser = createTestUser({ profileStatus: 'registration' });
      const undefinedStatusUser = createTestUser({ profileStatus: undefined });

      expect(UserService.prototype.needsRegistration(registrationUser)).toBe(true);
      expect(UserService.prototype.needsRegistration(undefinedStatusUser)).toBe(true);
    });
  });
});
