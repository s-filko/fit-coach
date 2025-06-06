import { UserService } from '@services/user.service';
import { UserDbService } from '@db/services/user-db.service';
import { CreateUserDto } from '@models/user.types';
import { pool } from '@db/db';

describe('UserService', () => {
  let userService: UserService;
  let userDbService: UserDbService;

  beforeEach(() => {
    userDbService = new UserDbService();
    userService = new UserService(userDbService);
  });

  describe('upsertUser', () => {
    it('should create new user when not exists', async () => {
      const userData: CreateUserDto = {
        provider: 'telegram',
        providerUserId: '123456',
        firstName: 'Test',
        lastName: 'User',
        languageCode: 'en'
      };

      const result = await userService.upsertUser(userData);

      expect(result).toBeDefined();
      expect(result.firstName).toBe(userData.firstName);
      expect(result.lastName).toBe(userData.lastName);
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0].provider).toBe(userData.provider);
      expect(result.accounts[0].providerUserId).toBe(userData.providerUserId);
    });

    it('should update existing user', async () => {
      // First create user
      const initialData: CreateUserDto = {
        provider: 'telegram',
        providerUserId: '123456',
        firstName: 'Test',
        lastName: 'User',
        languageCode: 'en'
      };
      const createdUser = await userService.upsertUser(initialData);

      // Then update
      const updateData: CreateUserDto = {
        ...initialData,
        firstName: 'Updated',
        lastName: 'Name'
      };
      const updatedUser = await userService.upsertUser(updateData);

      expect(updatedUser.id).toBe(createdUser.id);
      expect(updatedUser.firstName).toBe(updateData.firstName);
      expect(updatedUser.lastName).toBe(updateData.lastName);
    });
  });

  describe('getUser', () => {
    it('should return null for non-existent user', async () => {
      const result = await userService.getUser('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });
});

afterAll(async () => {
  await pool.end();
}); 