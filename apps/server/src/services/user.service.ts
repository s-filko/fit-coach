import { db } from '@db/db';
import { users, userAccounts } from '@db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '@middleware/error';
import { User, UserAccount, CreateUserDto, UserResponseDto } from '@/models/user.types';
import { createUserAccount, getUserAccount, updateUserAccount } from './userAccount.service';

export class UserService {
  async upsertUser(data: CreateUserDto): Promise<UserResponseDto> {
    try {
      // Check if user account already exists
      const existingAccount = await getUserAccount(data.provider, data.providerUserId);
      
      if (existingAccount) {
        try {
          // Update existing user
          const [user] = await db.update(users)
            .set({
              firstName: data.firstName || null,
              lastName: data.lastName || null,
              languageCode: data.languageCode || null,
              username: data.username || null,
            })
            .where(eq(users.id, existingAccount.userId))
            .returning();

          if (!user) {
            console.error('Failed to update user:', { userId: existingAccount.userId, data });
            throw new AppError(500, 'Failed to update user');
          }

          return {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            languageCode: user.languageCode,
            username: user.username,
            accounts: [{
              provider: existingAccount.provider,
              providerUserId: existingAccount.providerUserId,
              username: user.username
            }]
          };
        } catch (error) {
          console.error('Error updating user:', error);
          throw new AppError(500, 'Failed to update user');
        }
      }

      try {
        // Create new user
        const [user] = await db.insert(users).values({
          firstName: data.firstName || null,
          lastName: data.lastName || null,
          languageCode: data.languageCode || null,
          username: data.username || null,
        }).returning();

        if (!user) {
          console.error('Failed to create user:', { data });
          throw new AppError(500, 'Failed to create user');
        }

        // Create user account
        const account = await createUserAccount(
          user.id,
          data.providerUserId,
          data.provider,
          {}
        );

        if (!account) {
          console.error('Failed to create user account:', { userId: user.id, data });
          throw new AppError(500, 'Failed to create user account');
        }

        return {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          languageCode: user.languageCode,
          username: user.username,
          accounts: [{
            provider: account.provider,
            providerUserId: account.providerUserId,
            username: user.username
          }]
        };
      } catch (error) {
        console.error('Error creating new user:', error);
        throw new AppError(500, 'Failed to create new user');
      }
    } catch (error) {
      console.error('Error upserting user:', error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'Failed to upsert user');
    }
  }

  async getUser(userId: string): Promise<UserResponseDto | null> {
    try {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId)
      });

      if (!user) return null;

      const accounts = await db.query.userAccounts.findMany({
        where: eq(userAccounts.userId, userId)
      });

      return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        languageCode: user.languageCode,
        username: user.username,
        accounts: accounts.map(account => ({
          provider: account.provider,
          providerUserId: account.providerUserId,
          username: user.username
        }))
      };
    } catch (error) {
      console.error('Error getting user:', error);
      throw new AppError(500, 'Failed to get user');
    }
  }
} 