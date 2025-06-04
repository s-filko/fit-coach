import { users, userAccounts } from '@db/schema';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// Database models
export type User = InferSelectModel<typeof users>;
export type UserAccount = InferSelectModel<typeof userAccounts>;
export type NewUser = InferInsertModel<typeof users>;
export type NewUserAccount = InferInsertModel<typeof userAccounts>;

// DTOs
export interface CreateUserDto {
  provider: string;
  providerUserId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}

export interface UserResponseDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  username: string | null;
  accounts: {
    provider: string;
    providerUserId: string;
    username: string | null;
  }[];
} 