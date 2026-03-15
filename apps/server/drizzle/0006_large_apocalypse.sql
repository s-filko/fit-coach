CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "embedding" vector(384);--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exercises_embedding" ON "exercises" USING hnsw ("embedding" vector_cosine_ops);