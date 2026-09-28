ALTER TABLE "prompt_blobs" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "prompt_hashes" text[];