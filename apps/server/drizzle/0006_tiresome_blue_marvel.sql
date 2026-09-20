CREATE TYPE "public"."fact_archived_reason" AS ENUM('user_closed', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."fact_durability" AS ENUM('permanent', 'long_term', 'short');--> statement-breakpoint
CREATE TYPE "public"."fact_on_expiry" AS ENUM('forget', 'ask_once');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "durability" "fact_durability" DEFAULT 'permanent' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "review_after" timestamp;--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "phase_note" text;--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "phase_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "on_expiry" "fact_on_expiry";--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "status" "fact_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "archived_reason" "fact_archived_reason";--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "closed_by_user_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "user_facts" ADD COLUMN "context" text;--> statement-breakpoint
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_supersedes_id_user_facts_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."user_facts"("id") ON DELETE no action ON UPDATE no action;