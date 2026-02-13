ALTER TYPE "public"."conversation_phase" ADD VALUE 'session_planning' BEFORE 'training';--> statement-breakpoint
ALTER TABLE "workout_sessions" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "workout_sessions" ALTER COLUMN "status" SET DEFAULT 'planning'::text;--> statement-breakpoint
DROP TYPE "public"."session_status";--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('planning', 'in_progress', 'completed', 'skipped');--> statement-breakpoint
ALTER TABLE "workout_sessions" ALTER COLUMN "status" SET DEFAULT 'planning'::"public"."session_status";--> statement-breakpoint
ALTER TABLE "workout_sessions" ALTER COLUMN "status" SET DATA TYPE "public"."session_status" USING "status"::"public"."session_status";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "height" SET DATA TYPE numeric(5, 1);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "weight" SET DATA TYPE numeric(5, 1);--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "session_plan_json" jsonb;