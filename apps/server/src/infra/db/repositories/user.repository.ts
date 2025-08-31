import { randomUUID } from 'crypto';
import { CreateUserInput, User, UserRepository } from '@domain/user/services/user.service';
import { eq, and } from 'drizzle-orm';

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

export class DrizzleUserRepository implements UserRepository {
  async findByProvider(provider: string, providerUserId: string): Promise<User | null> {
    const { db } = await import('@infra/db/drizzle');
    const { userAccounts, users } = await import('@infra/db/schema');
    const rows = await db.select().from(userAccounts).where(and(eq(userAccounts.provider, provider), eq(userAccounts.providerUserId, providerUserId))).limit(1);
    const acc = rows[0];
    if (!acc) return null;
    const u = await db.select().from(users).where(eq(users.id, acc.userId)).limit(1);
    const row = u[0];
    if (!row) return null;
    return { id: row.id, username: row.username ?? undefined, firstName: row.firstName ?? undefined, lastName: row.lastName ?? undefined, languageCode: row.languageCode ?? undefined };
  }

  async create(data: CreateUserInput): Promise<User> {
    const { db } = await import('@infra/db/drizzle');
    const { users, userAccounts } = await import('@infra/db/schema');
    const [u] = await db.insert(users).values({
      username: data.username ?? null,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      languageCode: data.languageCode ?? null,
    }).returning({ id: users.id });
    await db.insert(userAccounts).values({ userId: u.id, provider: data.provider, providerUserId: data.providerUserId });
    return { id: u.id, username: data.username, firstName: data.firstName, lastName: data.lastName, languageCode: data.languageCode };
  }

  async getById(id: string): Promise<User | null> {
    const { db } = await import('@infra/db/drizzle');
    const { users } = await import('@infra/db/schema');
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, username: row.username ?? undefined, firstName: row.firstName ?? undefined, lastName: row.lastName ?? undefined, languageCode: row.languageCode ?? undefined };
  }
}


