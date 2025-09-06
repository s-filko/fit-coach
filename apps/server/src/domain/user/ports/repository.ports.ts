import { User, CreateUserInput } from '../services/user.service';

// DI Tokens for repositories
export const USER_REPOSITORY_TOKEN = Symbol('UserRepository');

// Repository interfaces - data access contracts
export interface UserRepository {
  findByProvider(provider: string, providerUserId: string): Promise<User | null>;
  create(data: CreateUserInput): Promise<User>;
  getById(id: string): Promise<User | null>;
  updateProfileData(id: string, data: Partial<User>): Promise<User | null>;
}
