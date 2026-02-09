// Database schema definitions
import { integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  languageCode: text('language_code'),
  // Profile data
  gender: text('gender'),
  age: integer('age'),
  height: integer('height'),
  weight: integer('weight'),
  fitnessGoal: text('fitness_goal'),
  fitnessLevel: text('fitness_level'), // 'beginner', 'intermediate', 'advanced'
  // Registration-related fields
  profileStatus: text('profile_status').default('incomplete'), // 'incomplete', 'collecting_basic', 'collecting_level', 'collecting_goals', 'confirmation', 'complete'
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const userAccounts = pgTable('user_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  provider: text('provider').notNull(),
  providerUserId: text('provider_user_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
  return {
    uniqueProviderAccount: unique().on(table.provider, table.providerUserId),
  };
});

