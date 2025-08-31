export interface User {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}

export interface CreateUserInput {
  provider: string;
  providerUserId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}

export interface UserRepository {
  findByProvider(provider: string, providerUserId: string): Promise<User | null>;
  create(data: CreateUserInput): Promise<User>;
  getById(id: string): Promise<User | null>;
}

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async upsertUser(input: CreateUserInput): Promise<User> {
    const existing = await this.repo.findByProvider(input.provider, input.providerUserId);
    if (existing) return existing; // minimal behavior
    return this.repo.create(input);
  }

  async getUser(userId: string): Promise<User | null> {
    return this.repo.getById(userId);
  }
}
