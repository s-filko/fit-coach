CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "id_new" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" ADD COLUMN "exercise_id_new" uuid;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD COLUMN "exercise_id_new" uuid;--> statement-breakpoint
UPDATE "exercise_muscle_groups" g SET "exercise_id_new" = e."id_new" FROM "exercises" e WHERE e."id" = g."exercise_id";--> statement-breakpoint
UPDATE "session_exercises" s SET "exercise_id_new" = e."id_new" FROM "exercises" e WHERE e."id" = s."exercise_id";--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" DROP CONSTRAINT "exercise_muscle_groups_exercise_id_exercises_id_fk";--> statement-breakpoint
ALTER TABLE "session_exercises" DROP CONSTRAINT "session_exercises_exercise_id_exercises_id_fk";--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" DROP CONSTRAINT "exercise_muscle_groups_exercise_id_muscle_group_pk";--> statement-breakpoint
ALTER TABLE "exercises" DROP CONSTRAINT "exercises_pkey";--> statement-breakpoint
ALTER TABLE "exercises" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "exercises" RENAME COLUMN "id_new" TO "id";--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" DROP COLUMN "exercise_id";--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" RENAME COLUMN "exercise_id_new" TO "exercise_id";--> statement-breakpoint
ALTER TABLE "session_exercises" DROP COLUMN "exercise_id";--> statement-breakpoint
ALTER TABLE "session_exercises" RENAME COLUMN "exercise_id_new" TO "exercise_id";--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" ALTER COLUMN "exercise_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "session_exercises" ALTER COLUMN "exercise_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" ADD CONSTRAINT "exercise_muscle_groups_exercise_id_muscle_group_pk" PRIMARY KEY ("exercise_id", "muscle_group");--> statement-breakpoint
ALTER TABLE "exercise_muscle_groups" ADD CONSTRAINT "exercise_muscle_groups_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id");--> statement-breakpoint
DROP SEQUENCE IF EXISTS "exercises_id_seq";--> statement-breakpoint
ALTER TABLE "exercises" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "embedding" vector(384);--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exercises_embedding" ON "exercises" USING hnsw ("embedding" vector_cosine_ops);
