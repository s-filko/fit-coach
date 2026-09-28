CREATE TYPE "public"."set_kind" AS ENUM('warmup', 'working');--> statement-breakpoint
ALTER TABLE "session_sets" ADD COLUMN "set_kind" "set_kind";--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "place" text;