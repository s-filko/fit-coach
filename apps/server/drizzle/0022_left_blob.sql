ALTER TABLE "llm_calls" ADD COLUMN "cache_break" text;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "cache_break_lost_tokens" integer;