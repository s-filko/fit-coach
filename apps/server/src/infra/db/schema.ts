// Database schema definitions
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Enums for conversation_turns
// MVP phases: 'registration' | 'chat'
// Future phases: 'training' (see conversation.spec.md, FEAT-0008)
export const conversationPhaseEnum = pgEnum('conversation_phase', ['registration', 'chat', 'session_planning', 'training']);
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
  // MVP uses simplified status model: 'incomplete' | 'complete'
  // Future: 'registration' | 'onboarding' | 'planning' | 'active' (see ADR-0004, user.spec.md)
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

// --- Training domain enums (see plan: training_session_management_mvp) ---

export const exerciseTypeEnum = pgEnum('exercise_type', [
  'strength',
  'cardio_distance',
  'cardio_duration',
  'functional_reps',
  'isometric',
  'interval',
]);

export const muscleGroupEnum = pgEnum('muscle_group', [
  'chest',
  'back_lats',
  'back_traps',
  'shoulders_front',
  'shoulders_side',
  'shoulders_rear',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'lower_back',
  'core',
  'cardio_system',
  'full_body',
  'lower_body_endurance',
  'core_stability',
]);

export const workoutPlanStatusEnum = pgEnum('workout_plan_status', ['draft', 'active', 'archived']);

export const sessionStatusEnum = pgEnum('session_status', [
  'planning',    // Session created, LLM is generating/user is modifying plan
  'in_progress', // Training started
  'completed',   // Training finished
  'skipped',     // User cancelled/skipped
]);

export const sessionExerciseStatusEnum = pgEnum('session_exercise_status', [
  'pending',
  'in_progress',
  'completed',
  'skipped',
]);

// --- Training domain tables ---

export const workoutPlans = pgTable(
  'workout_plans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    planJson: jsonb('plan_json').notNull(),
    status: workoutPlanStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userStatusIdx: index('idx_workout_plans_user_status').on(
      table.userId,
      table.status,
    ),
  }),
);

export const exercises = pgTable(
  'exercises',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull().unique(),
    category: text('category').notNull(),
    equipment: text('equipment').notNull(),
    exerciseType: exerciseTypeEnum('exercise_type').notNull(),
    description: text('description'),
    energyCost: text('energy_cost').notNull(),
    complexity: text('complexity').notNull(),
    typicalDurationMinutes: integer('typical_duration_minutes').notNull(),
    requiresSpotter: boolean('requires_spotter').default(false),
    imageUrl: text('image_url'),
    videoUrl: text('video_url'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    categoryIdx: index('idx_exercises_category').on(table.category),
    energyCostIdx: index('idx_exercises_energy_cost').on(table.energyCost),
    typeIdx: index('idx_exercises_type').on(table.exerciseType),
  }),
);

export const exerciseMuscleGroups = pgTable(
  'exercise_muscle_groups',
  {
    exerciseId: integer('exercise_id')
      .references(() => exercises.id, { onDelete: 'cascade' })
      .notNull(),
    muscleGroup: muscleGroupEnum('muscle_group').notNull(),
    involvement: text('involvement').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.exerciseId, table.muscleGroup] }),
    muscleIdx: index('idx_exercise_muscle_groups_muscle').on(table.muscleGroup),
  }),
);

export const workoutSessions = pgTable(
  'workout_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    planId: uuid('plan_id').references(() => workoutPlans.id, {
      onDelete: 'set null',
    }),
    sessionKey: text('session_key'),
    status: sessionStatusEnum('status').notNull().default('planning'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    durationMinutes: integer('duration_minutes'),
    userContextJson: jsonb('user_context_json'),
    // Session plan (LLM recommendation) stored as structured JSON
    // Contains: exercises list, reasoning, estimated duration, warnings
    // Updated during session_planning phase, read-only during training
    sessionPlanJson: jsonb('session_plan_json'),
    lastActivityAt: timestamp('last_activity_at')
      .defaultNow()
      .notNull(),
    autoCloseReason: text('auto_close_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userCompletedIdx: index('idx_workout_sessions_user_completed').on(
      table.userId,
      table.completedAt,
    ),
    userStatusIdx: index('idx_workout_sessions_user_status').on(
      table.userId,
      table.status,
    ),
    activityIdx: index('idx_workout_sessions_activity').on(
      table.userId,
      table.status,
      table.lastActivityAt,
    ),
    abandonedIdx: index('idx_workout_sessions_abandoned').on(
      table.status,
      table.lastActivityAt,
    ),
  }),
);

export const sessionExercises = pgTable(
  'session_exercises',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .references(() => workoutSessions.id, { onDelete: 'cascade' })
      .notNull(),
    exerciseId: integer('exercise_id')
      .references(() => exercises.id)
      .notNull(),
    orderIndex: integer('order_index').notNull(),
    status: sessionExerciseStatusEnum('status').notNull().default('pending'),
    targetSets: integer('target_sets'),
    targetReps: text('target_reps'),
    targetWeight: numeric('target_weight', { precision: 6, scale: 2 }),
    actualRepsRange: text('actual_reps_range'),
    userFeedback: text('user_feedback'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    sessionOrderIdx: index('idx_session_exercises_session').on(
      table.sessionId,
      table.orderIndex,
    ),
  }),
);

export const sessionSets = pgTable(
  'session_sets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionExerciseId: uuid('session_exercise_id')
      .references(() => sessionExercises.id, { onDelete: 'cascade' })
      .notNull(),
    setNumber: integer('set_number').notNull(),
    rpe: integer('rpe'),
    userFeedback: text('user_feedback'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
    setData: jsonb('set_data').notNull(),
  },
  (table) => ({
    exerciseSetIdx: index('idx_session_sets_exercise').on(
      table.sessionExerciseId,
      table.setNumber,
    ),
    // GIN index on set_data for jsonb queries - add manually in migration if needed
    validSetDataCheck: check(
      'valid_set_data',
      sql`jsonb_typeof(${table.setData}) = 'object' AND ${table.setData} ? 'type'`,
    ),
  }),
);

