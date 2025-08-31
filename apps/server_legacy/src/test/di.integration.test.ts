import { Container } from '@services/di/injectable';
import { registerServices } from '@services/di/register';
import { UserService } from '@services/user.service';

describe('DI Container Integration', () => {
  beforeAll(async () => {
    await registerServices();
  });

  it('should resolve UserService from container', () => {
    const container = Container.getInstance();
    expect(() => container.get<UserService>('UserService')).not.toThrow();
    const userService = container.get<UserService>('UserService');
    expect(userService).toBeInstanceOf(UserService);
  });
}); 