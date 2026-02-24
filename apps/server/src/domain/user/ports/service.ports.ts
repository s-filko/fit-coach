import { CreateUserInput, User } from '@domain/user/services/user.service';

export const USER_SERVICE_TOKEN = Symbol('UserService');

export interface IUserService {
  upsertUser(data: CreateUserInput): Promise<User>;
  getUser(id: string): Promise<User | null>;
  updateProfileData(id: string, data: Partial<User>): Promise<User | null>;
  isRegistrationComplete(user: User): boolean;
  needsRegistration(user: User): boolean;
}
