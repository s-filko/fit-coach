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
  name: string | null;
  email: string | null;
  gender: string | null;
  height: number | null;
  heightUnit: string | null;
  weightUnit: string | null;
  birthYear: number | null;
  fitnessGoal: string | null;
  tone: string | null;
  reminderEnabled: boolean;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  username: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  accounts: {
    id: string;
    provider: string;
    providerUserId: string;
    userId: string;
    createdAt: Date | null;
    updatedAt: Date | null;
  }[];
} 