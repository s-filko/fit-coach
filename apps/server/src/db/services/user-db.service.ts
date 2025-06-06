import { eq, and } from 'drizzle-orm';
import { BaseDbService } from './base-db.service';
import { db } from '@db/db';
import { users, userAccounts } from '@db/schema';
import { User, UserAccount, CreateUserDto, UserResponseDto } from '@models/user.types';
import { AppError } from '@middleware/error';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { InferSelectModel } from 'drizzle-orm';

type UserSelect = InferSelectModel<typeof users>;
type UserAccountSelect = InferSelectModel<typeof userAccounts>;

export class UserDbService extends BaseDbService {
  constructor() {
    super(db);
  }

  async findById(userId: string): Promise<UserSelect | null> {
    return this.withErrorHandling(async () => {
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, userId)
      });
      return user || null;
    });
  }

  async findByProvider(provider: string, providerUserId: string): Promise<UserAccountSelect | null> {
    return this.withErrorHandling(async () => {
      const account = await this.db.query.userAccounts.findFirst({
        where: eq(userAccounts.providerUserId, providerUserId)
      });
      return account || null;
    });
  }

  async createUser(data: CreateUserDto): Promise<UserSelect> {
    return this.transaction(async (tx) => {
      const [user] = await tx.insert(users)
        .values({
          firstName: data.firstName || null,
          lastName: data.lastName || null,
          languageCode: data.languageCode || null,
          username: data.username || null,
        })
        .returning();

      if (!user) {
        throw new AppError(500, 'Failed to create user');
      }

      await tx.insert(userAccounts)
        .values({
          userId: user.id,
          provider: data.provider,
          providerUserId: data.providerUserId,
        });

      return user;
    });
  }

  async updateUser(userId: string, data: Partial<CreateUserDto>): Promise<UserSelect> {
    return this.withErrorHandling(async () => {
      const [user] = await this.db.update(users)
        .set({
          firstName: data.firstName || null,
          lastName: data.lastName || null,
          languageCode: data.languageCode || null,
          username: data.username || null,
        })
        .where(eq(users.id, userId))
        .returning();

      if (!user) {
        throw new AppError(404, 'User not found');
      }

      return user;
    });
  }

  async getUserWithAccounts(userId: string): Promise<UserResponseDto | null> {
    return this.withErrorHandling(async () => {
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, userId)
      });

      if (!user) return null;

      const accounts = await this.db.query.userAccounts.findMany({
        where: eq(userAccounts.userId, userId)
      });

      return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        languageCode: user.languageCode,
        username: user.username,
        accounts: accounts.map((account: UserAccountSelect) => ({
          provider: account.provider,
          providerUserId: account.providerUserId,
          username: user.username
        }))
      };
    });
  }

  async createUserAccount(
    userId: string,
    providerUserId: string,
    provider: string,
    accountData: Partial<Omit<typeof userAccounts.$inferInsert, 'userId' | 'providerUserId' | 'provider'>>
  ): Promise<UserAccountSelect> {
    const [account] = await this.db.insert(userAccounts).values({
      userId,
      providerUserId,
      provider,
      ...accountData,
    }).returning();
    return account;
  }

  async updateUserAccount(
    providerUserId: string,
    provider: string,
    accountData: Partial<Omit<typeof userAccounts.$inferInsert, 'userId' | 'providerUserId' | 'provider'>>
  ): Promise<UserAccountSelect> {
    const [account] = await this.db
      .update(userAccounts)
      .set(accountData)
      .where(
        and(
          eq(userAccounts.providerUserId, providerUserId),
          eq(userAccounts.provider, provider)
        )
      )
      .returning();
    return account;
  }

  async getUserAccount(
    provider: string,
    providerUserId: string
  ): Promise<UserAccountSelect | null> {
    const account = await this.db.query.userAccounts.findFirst({
      where: and(
        eq(userAccounts.provider, provider),
        eq(userAccounts.providerUserId, providerUserId)
      )
    });
    return account || null;
  }

  async getUserByProvider(provider: string, providerUserId: string): Promise<UserSelect | null> {
    try {
      const account = await this.getUserAccount(provider, providerUserId);
      if (!account) return null;
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, account.userId)
      });
      return user || null;
    } catch (error) {
      console.error('Error getting user by provider:', error);
      throw error;
    }
  }
} 