import { relations } from "drizzle-orm/relations";
import { users, coachSettings, exerciseLogs, exercises, trainingContext, userAccounts, userMemories, userMetrics, aiSessions, workouts, workoutExercises } from "./schema";

export const coachSettingsRelations = relations(coachSettings, ({one}) => ({
	user: one(users, {
		fields: [coachSettings.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	coachSettings: many(coachSettings),
	exerciseLogs: many(exerciseLogs),
	exercises: many(exercises),
	trainingContexts: many(trainingContext),
	userAccounts: many(userAccounts),
	userMemories: many(userMemories),
	userMetrics: many(userMetrics),
	aiSessions: many(aiSessions),
	workouts: many(workouts),
}));

export const exerciseLogsRelations = relations(exerciseLogs, ({one}) => ({
	user: one(users, {
		fields: [exerciseLogs.userId],
		references: [users.id]
	}),
	exercise: one(exercises, {
		fields: [exerciseLogs.exerciseId],
		references: [exercises.id]
	}),
}));

export const exercisesRelations = relations(exercises, ({one, many}) => ({
	exerciseLogs: many(exerciseLogs),
	user: one(users, {
		fields: [exercises.createdBy],
		references: [users.id]
	}),
	workoutExercises: many(workoutExercises),
}));

export const trainingContextRelations = relations(trainingContext, ({one}) => ({
	user: one(users, {
		fields: [trainingContext.userId],
		references: [users.id]
	}),
}));

export const userAccountsRelations = relations(userAccounts, ({one}) => ({
	user: one(users, {
		fields: [userAccounts.userId],
		references: [users.id]
	}),
}));

export const userMemoriesRelations = relations(userMemories, ({one}) => ({
	user: one(users, {
		fields: [userMemories.userId],
		references: [users.id]
	}),
}));

export const userMetricsRelations = relations(userMetrics, ({one}) => ({
	user: one(users, {
		fields: [userMetrics.userId],
		references: [users.id]
	}),
}));

export const aiSessionsRelations = relations(aiSessions, ({one}) => ({
	user: one(users, {
		fields: [aiSessions.userId],
		references: [users.id]
	}),
}));

export const workoutsRelations = relations(workouts, ({one, many}) => ({
	user: one(users, {
		fields: [workouts.userId],
		references: [users.id]
	}),
	workoutExercises: many(workoutExercises),
}));

export const workoutExercisesRelations = relations(workoutExercises, ({one}) => ({
	workout: one(workouts, {
		fields: [workoutExercises.workoutId],
		references: [workouts.id]
	}),
	exercise: one(exercises, {
		fields: [workoutExercises.exerciseId],
		references: [exercises.id]
	}),
}));