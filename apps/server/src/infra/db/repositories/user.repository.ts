import { randomUUID } from 'crypto';
import { CreateUserInput, User, UserRepository } from '@domain/user/services/user.service';

type ProviderKey = `${string}:${string}`; // provider:providerUserId

export class InMemoryUserRepository implements UserRepository {
  private byId = new Map<string, User>();
  private byProvider = new Map<ProviderKey, string>();

  async findByProvider(provider: string, providerUserId: string): Promise<User | null> {
    const key: ProviderKey = `${provider}:${providerUserId}`;
    const id = this.byProvider.get(key);
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }

  async create(data: CreateUserInput): Promise<User> {
    const id = randomUUID();
    const user: User = {
      id,
      username: data.username,
      firstName: data.firstName,
      lastName: data.lastName,
      languageCode: data.languageCode,
    };
    const key: ProviderKey = `${data.provider}:${data.providerUserId}`;
    this.byId.set(id, user);
    this.byProvider.set(key, id);
    return user;
  }

  async getById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }
}


