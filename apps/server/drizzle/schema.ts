// drizzle/schema.ts
import { pgTable, text, integer, real, boolean, timestamp, uuid, vector } from 'drizzle-orm/pg-core';

// Users table
export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name'),
    email: text('email').unique(),
    gender: text('gender'),
    height: integer('height'),
    heightUnit: text('height_unit'),
    weightUnit: text('weight_unit'),
    birthYear: integer('birth_year'),
    fitnessGoal: text('fitness_goal'),
    tone: text('tone'),
    reminderEnabled: boolean('reminder_enabled').default(false),
    createdAt: timestamp('created_at').defaultNow(),
});

// User profile extensions (changing over time)
export const userMetrics = pgTable('user_metrics', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    weight: real('weight'),
    chest: real('chest'),
    waist: real('waist'),
    hips: real('hips'),
    biceps: real('biceps'),
    thigh: real('thigh'),
    experienceLevel: text('experience_level'),
    activityLevel: text('activity_level'),
    createdAt: timestamp('created_at').defaultNow(),
});

// Exercises table
export const exercises = pgTable('exercises', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name'),
    category: text('category'), // like "legs", "chest"
    isGlobal: boolean('is_global').default(true),
    createdBy: uuid('created_by'), // null for global
    description: text('description'), // Optional general description
    technique: text('technique'), // Instructions on how to perform the exercise
    embedding: vector('embedding', { dimensions: 1536 }),
});

// Workouts table
export const workouts = pgTable('workouts', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    name: text('name'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow(),
});

// Workout Exercises (many-to-many)
export const workoutExercises = pgTable('workout_exercises', {
    id: uuid('id').defaultRandom().primaryKey(),
    workoutId: uuid('workout_id').references(() => workouts.id),
    exerciseId: uuid('exercise_id').references(() => exercises.id),
    order: integer('order'),
});

// Exercise Log
export const exerciseLogs = pgTable('exercise_logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    exerciseId: uuid('exercise_id').references(() => exercises.id),
    date: timestamp('date').defaultNow(),
    sets: integer('sets'),
    reps: integer('reps'),
    weight: real('weight'),
    comment: text('comment'),
});

// AI Interaction Sessions
export const aiSessions = pgTable('ai_sessions', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    startedAt: timestamp('started_at').defaultNow(),
    endedAt: timestamp('ended_at'),
    sessionType: text('session_type'), // e.g., "workout", "chat", etc.
    summary: text('summary'), // Optional short summary or notes
    embedding: vector('embedding', { dimensions: 1536 }),
});

// AI Coach Behavior
export const coachSettings = pgTable('coach_settings', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    tone: text('tone'),
    behaviorRules: text('behavior_rules'),
    encouragementStyle: text('encouragement_style'),
    prepHints: boolean('prep_hints').default(true),
    feedbackQuestions: boolean('feedback_questions').default(true),
});

// User Memories table
export const userMemories = pgTable('user_memories', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    topic: text('topic'), // Optional topic/category
    content: text('content'), // Memory content (e.g., "I hate burpees")
    embedding: vector('embedding', { dimensions: 1536 }), // Adjust to match your embedding model
    createdAt: timestamp('created_at').defaultNow(),
});