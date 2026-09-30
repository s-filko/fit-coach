ALTER TABLE "conversation_runs" ADD COLUMN "tokens_cache_write" integer;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "cache_write_tokens" integer;