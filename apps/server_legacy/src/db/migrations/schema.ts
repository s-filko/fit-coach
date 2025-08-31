import { pgTable, foreignKey, uuid, text, boolean, timestamp, integer, real, vector, jsonb, unique } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const coachSettings = pgTable("coach_settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	tone: text(),
	behaviorRules: text("behavior_rules"),
	encouragementStyle: text("encouragement_style"),
	prepHints: boolean("prep_hints").default(true),
	feedbackQuestions: boolean("feedback_questions").default(true),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "coach_settings_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const exerciseLogs = pgTable("exercise_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	exerciseId: uuid("exercise_id"),
	date: timestamp({ mode: 'string' }).defaultNow(),
	sets: integer(),
	reps: integer(),
	weight: real(),
	comment: text(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "exercise_logs_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.exerciseId],
			foreignColumns: [exercises.id],
			name: "exercise_logs_exercise_id_exercises_id_fk"
		}).onDelete("cascade"),
]);

export const exercises = pgTable("exercises", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text(),
	category: text(),
	isGlobal: boolean("is_global").default(true),
	createdBy: uuid("created_by"),
	description: text(),
	technique: text(),
	embedding: vector({ dimensions: 1536 }),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "exercises_created_by_users_id_fk"
		}).onDelete("set null"),
]);

export const trainingContext = pgTable("training_context", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	primaryGoal: text("primary_goal"),
	targetAreas: jsonb("target_areas"),
	timelineMonths: integer("timeline_months"),
	strengthLevel: text("strength_level"),
	recoveryStatus: text("recovery_status"),
	recentProgress: jsonb("recent_progress"),
	trainingSchedule: jsonb("training_schedule"),
	intensityPreference: text("intensity_preference"),
	equipmentAvailable: text("equipment_available").array(),
	physicalLimitations: text("physical_limitations").array(),
	timeLimitations: jsonb("time_limitations"),
	lastUpdated: timestamp("last_updated", { mode: 'string' }).defaultNow(),
	notes: text(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "training_context_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const userAccounts = pgTable("user_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	provider: text().notNull(),
	providerUserId: text("provider_user_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_accounts_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("user_accounts_provider_provider_user_id_unique").on(table.provider, table.providerUserId),
]);

export const userMemories = pgTable("user_memories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	topic: text(),
	content: text(),
	embedding: vector({ dimensions: 1536 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_memories_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const userMetrics = pgTable("user_metrics", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	weight: real(),
	chest: real(),
	waist: real(),
	hips: real(),
	biceps: real(),
	thigh: real(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_metrics_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text(),
	email: text(),
	gender: text(),
	height: integer(),
	heightUnit: text("height_unit"),
	weightUnit: text("weight_unit"),
	birthYear: integer("birth_year"),
	fitnessGoal: text("fitness_goal"),
	tone: text(),
	reminderEnabled: boolean("reminder_enabled").default(false),
	firstName: text("first_name"),
	lastName: text("last_name"),
	languageCode: text("language_code"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	username: text(),
}, (table) => [
	unique("users_email_unique").on(table.email),
]);

export const aiSessions = pgTable("ai_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	startedAt: timestamp("started_at", { mode: 'string' }).defaultNow(),
	endedAt: timestamp("ended_at", { mode: 'string' }),
	sessionType: text("session_type"),
	summary: text(),
	embedding: vector({ dimensions: 1536 }),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "ai_sessions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const workouts = pgTable("workouts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	name: text(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "workouts_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const workoutExercises = pgTable("workout_exercises", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workoutId: uuid("workout_id"),
	exerciseId: uuid("exercise_id"),
	order: integer(),
}, (table) => [
	foreignKey({
			columns: [table.workoutId],
			foreignColumns: [workouts.id],
			name: "workout_exercises_workout_id_workouts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.exerciseId],
			foreignColumns: [exercises.id],
			name: "workout_exercises_exercise_id_exercises_id_fk"
		}).onDelete("cascade"),
]);
