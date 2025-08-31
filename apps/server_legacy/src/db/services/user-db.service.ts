import { eq, and } from 'drizzle-orm';
import { BaseDbService } from './base-db.service';
import { db } from '@db/db';
import { users, userAccounts } from '@db/schema';
import { User, UserAccount, CreateUserDto, UserResponseDto } from '@models/user.types';
import { AppError } from '@middleware/error';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { InferSelectModel } from 'drizzle-orm';
import { Injectable } from '@services/di/injectable';

type UserSelect = InferSelectModel<typeof users>;
type UserAccountSelect = InferSelectModel<typeof userAccounts>;

@Injectable()
export class UserDbService extends BaseDbService {
  constructor() {
    super(db);
    console.log('UserDbService initialized with db connection');
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
    console.log('Finding user by provider:', { provider, providerUserId });
    return this.withErrorHandling(async () => {
      const account = await this.db.query.userAccounts.findFirst({
        where: and(
          eq(userAccounts.provider, provider),
          eq(userAccounts.providerUserId, providerUserId)
        )
      });
      console.log('Found account:', account);
      return account || null;
    });
  }

  async createUser(data: CreateUserDto): Promise<UserSelect> {
    console.log('Creating user with data:', data);
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
        console.error('Failed to create user');
        throw new AppError(500, 'Failed to create user');
      }

      console.log('Created user:', user);

      const [account] = await tx.insert(userAccounts)
        .values({
          userId: user.id,
          provider: data.provider,
          providerUserId: data.providerUserId,
        })
        .returning();

      console.log('Created account:', account);

      return user;
    });
  }

  async updateUser(userId: string, data: Partial<CreateUserDto>): Promise<UserSelect> {
    console.log('Updating user:', { userId, data });
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
        console.error('User not found:', userId);
        throw new AppError(404, 'User not found');
      }

      console.log('Updated user:', user);
      return user;
    });
  }

  async getUserWithAccounts(userId: string): Promise<UserResponseDto | null> {
    console.log('Getting user with accounts:', userId);
    return this.withErrorHandling(async () => {
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, userId)
      });

      if (!user) {
        console.log('User not found:', userId);
        return null;
      }

      const accounts = await this.db.query.userAccounts.findMany({
        where: eq(userAccounts.userId, userId)
      });

      console.log('Found accounts:', accounts);

      const response = {
        id: user.id,
        name: user.name,
        email: user.email,
        gender: user.gender,
        height: user.height,
        heightUnit: user.heightUnit,
        weightUnit: user.weightUnit,
        birthYear: user.birthYear,
        fitnessGoal: user.fitnessGoal,
        tone: user.tone,
        reminderEnabled: user.reminderEnabled ?? false,
        firstName: user.firstName,
        lastName: user.lastName,
        languageCode: user.languageCode,
        username: user.username,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        accounts: accounts.map(account => ({
          id: account.id,
          provider: account.provider,
          providerUserId: account.providerUserId,
          userId: account.userId,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt
        }))
      };

      console.log('Returning user response:', response);
      return response;
    });
  }

  async createUserAccount(
    userId: string,
    providerUserId: string,
    provider: string,
    accountData: Partial<Omit<typeof userAccounts.$inferInsert, 'userId' | 'providerUserId' | 'provider'>>
  ): Promise<UserAccountSelect> {
    console.log('Creating user account:', { userId, providerUserId, provider, accountData });
    const [account] = await this.db.insert(userAccounts).values({
      userId,
      providerUserId,
      provider,
      ...accountData,
    }).returning();
    console.log('Created account:', account);
    return account;
  }

  async updateUserAccount(
    providerUserId: string,
    provider: string,
    accountData: Partial<Omit<typeof userAccounts.$inferInsert, 'userId' | 'providerUserId' | 'provider'>>
  ): Promise<UserAccountSelect> {
    console.log('Updating user account:', { providerUserId, provider, accountData });
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
    console.log('Updated account:', account);
    return account;
  }

  async getUserAccount(
    provider: string,
    providerUserId: string
  ): Promise<UserAccountSelect | null> {
    console.log('Getting user account:', { provider, providerUserId });
    const account = await this.db.query.userAccounts.findFirst({
      where: and(
        eq(userAccounts.provider, provider),
        eq(userAccounts.providerUserId, providerUserId)
      )
    });
    console.log('Found account:', account);
    return account || null;
  }

  async getUserByProvider(provider: string, providerUserId: string): Promise<UserSelect | null> {
    console.log('Getting user by provider:', { provider, providerUserId });
    try {
      const account = await this.getUserAccount(provider, providerUserId);
      if (!account) {
        console.log('Account not found');
        return null;
      }
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, account.userId)
      });
      console.log('Found user:', user);
      return user || null;
    } catch (error) {
      console.error('Error getting user by provider:', error);
      throw error;
    }
  }
} 