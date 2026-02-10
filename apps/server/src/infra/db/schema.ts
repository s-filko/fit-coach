// Database schema definitions
import { index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

// Enums for conversation_turns
export const conversationPhaseEnum = pgEnum('conversation_phase', ['registration', 'chat', 'training']);
export const conversationRoleEnum = pgEnum('conversation_role', ['user', 'assistant', 'system', 'summary']);

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
  profileStatus: text('profile_status').default('registration'), // 'registration' | 'complete'
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

// Conversation context: append-only table, one row per message (ADR-0005)
export const conversationTurns = pgTable('conversation_turns', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  phase: conversationPhaseEnum('phase').notNull(),
  role: conversationRoleEnum('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    userPhaseCreatedIdx: index('idx_conversation_turns_user_phase_created')
      .on(table.userId, table.phase, table.createdAt),
  };
});

