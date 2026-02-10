CREATE TYPE "public"."conversation_phase" AS ENUM('registration', 'chat', 'training');--> statement-breakpoint
CREATE TYPE "public"."conversation_role" AS ENUM('user', 'assistant', 'system', 'summary');--> statement-breakpoint
ALTER TABLE "conversation_turns" ALTER COLUMN "phase" SET DATA TYPE "public"."conversation_phase" USING "phase"::"public"."conversation_phase";--> statement-breakpoint
ALTER TABLE "conversation_turns" ALTER COLUMN "role" SET DATA TYPE "public"."conversation_role" USING "role"::"public"."conversation_role";