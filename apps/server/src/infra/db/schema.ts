// Temporary placeholder: we will migrate schema from legacy progressively.
import { pgTable, text, integer, boolean, timestamp, uuid, unique } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name'),
  email: text('email').unique(),
  gender: text('gender'),
  height: integer('height'),
  heightUnit: text('height_unit'),
  weight: integer('weight'),
  weightUnit: text('weight_unit'),
  birthYear: integer('birth_year'),
  age: integer('age'),
  fitnessGoal: text('fitness_goal'),
  tone: text('tone'),
  reminderEnabled: boolean('reminder_enabled').default(false),
  firstName: text('first_name'),
  lastName: text('last_name'),
  languageCode: text('language_code'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  username: text('username'),
  // Registration-related fields
  profileStatus: text('profile_status').default('incomplete'), // 'incomplete', 'collecting_basic', 'collecting_level', 'collecting_goals', 'confirmation', 'complete'
  fitnessLevel: text('fitness_level'), // 'beginner', 'intermediate', 'advanced'
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

